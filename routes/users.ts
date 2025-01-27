import { Application } from 'express'
import { Op } from 'sequelize'
import { User } from '../models'
import authenticateToken from '../utils/authenticateToken'
import checkCaptcha from '../utils/checkCaptcha'
import generateRandomString from '../utils/generateRandomString'
import getIp from '../utils/getIP'
import sendActivationEmail from '../utils/sendActivationEmail'
import validateEmail from '../utils/validateEmail'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import sequelize from '../db'
import optimizeMedia from '../utils/optimizeMedia'
import uploadHandler from '../uploads'
import * as ed from '@noble/ed25519'
import { generateKeyPairSync } from 'crypto'
const environment = require('../environment')

export default function userRoutes (app: Application) {
  app.post('/register', uploadHandler.single('avatar'), async (req, res) => {
    let success = false
    try {
      if (
        req.body &&
        req.body.email &&
        req.body.url &&
        req.body.url.indexOf('@') === -1 &&
        validateEmail(req.body.email) &&
        req.body.captchaResponse &&
        (await checkCaptcha(req.body.captchaResponse, getIp(req)))
      ) {
        const emailExists = await User.findOne({
          where: {
            [Op.or]: [
              { email: req.body.email.toLowerCase() },
              sequelize.where(
                sequelize.fn('LOWER', sequelize.col('url')),
                'LIKE',
                '%' + req.body.url.toLowerCase().trim() + '%'
              )
            ]
          }
        })
        if (!emailExists) {
          let avatarURL = '/uploads/default.webp'
          if (req.file != null) {
            avatarURL = '/' + await optimizeMedia(req.file.path)
          }
          if (environment.removeFolderNameFromFileUploads) {
            avatarURL = avatarURL.slice('/uploads/'.length - 1)
          }

          const activationCode = generateRandomString()
          const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength: 4096,
            publicKeyEncoding: {
              type: 'spki',
              format: 'pem'
            },
            privateKeyEncoding: {
              type: 'pkcs8',
              format: 'pem'
            }
          })
          const user = {
            email: req.body.email.toLowerCase(),
            description: req.body.description.trim(),
            url: req.body.url,
            NSFW: req.body.nsfw === 'true',
            password: await bcrypt.hash(
              req.body.password,
              environment.saltRounds
            ),
            birthDate: new Date(req.body.birthDate),
            avatar: avatarURL,
            activated: false,
            registerIp: getIp(req),
            lastLoginIp: 'ACCOUNT_NOT_ACTIVATED',
            activationCode,
            privateKey,
            publicKey
          }

          const userWithEmail = User.create(user)
          if (environment.adminId) {
            const adminUser = await User.findOne({
              where: {
                id: environment.adminId
              }
            })
            // follow staff!
            if (adminUser) {
              adminUser.addFollower(userWithEmail)
            }
          }
          const emailSent = sendActivationEmail(
            req.body.email.toLowerCase(),
            activationCode,
            'Welcome to wafrn!',
            '<h1>Welcome to wafrn</h1> To activate your account <a href="' +
              environment.frontendUrl +
              '/activate/' +
              encodeURIComponent(req.body.email.toLowerCase()) +
              '/' +
              activationCode +
              '">click here!</a>'
          )
          await Promise.all([userWithEmail, emailSent])
          success = true
          res.send({
            success: true
          })
        }
      }
    } catch (error) {
      console.error(error)
    }
    if (!success) {
      res.statusCode = 401
      res.send({ success: false })
    }
  })

  app.post('/editProfile', authenticateToken, uploadHandler.single('avatar'), async (req, res) => {
    let success = false
    try {
      const posterId = (req as any).jwtData.userId
      const user = await User.findOne({
        where: {
          id: posterId
        }
      })
      if (req.body) {
        if (req.body.description) {
          user.description = req.body.description
        }

        if (req.file != null) {
          let avatarURL = '/' + optimizeMedia(req.file.path)
          if (environment.removeFolderNameFromFileUploads) {
            avatarURL = avatarURL.slice('/uploads/'.length - 1)
            user.avatar = avatarURL
          }
        }

        user.save()
        success = true
      }
    } catch (error) {
      console.error(error)
    }

    res.send({
      success
    })
  })

  app.post('/forgotPassword', async (req, res) => {
    const resetCode = generateRandomString()
    try {
      if (
        req.body &&
        req.body.email &&
        validateEmail(req.body.email) &&
        req.body.captchaResponse &&
        (await checkCaptcha(req.body.captchaResponse, getIp(req)))
      ) {
        const user = await User.findOne({
          where: {
            email: req.body.email.toLowerCase()
          }
        })
        if (user) {
          user.activationCode = resetCode
          user.requestedPasswordReset = new Date()
          user.save()
          // eslint-disable-next-line no-unused-vars
          const email = await sendActivationEmail(
            req.body.email.toLowerCase(),
            '',
            'So you forgot your wafrn password',
            '<h1>Use this link to reset your password</h1> Click <a href="' +
              environment.frontendUrl +
              '/resetPassword/' +
              encodeURIComponent(req.body.email.toLowerCase()) +
              '/' +
              resetCode +
              '">here</a> to reset your password'
          )
        }
      }
    } catch (error) {
      console.error(error)
    }

    res.send({ success: true })
  })

  app.post('/activateUser', async (req, res) => {
    let success = false
    if (
      req.body &&
      req.body.email &&
      validateEmail(req.body.email) &&
      req.body.code
    ) {
      const user = await User.findOne({
        where: {
          email: req.body.email.toLowerCase(),
          activationCode: req.body.code
        }
      })
      if (user) {
        user.activated = true
        user.save()
        success = true
      }
    }

    res.send({
      success
    })
  })

  app.post('/resetPassword', async (req, res) => {
    let success = false

    try {
      if (
        req.body &&
        req.body.email &&
        req.body.code &&
        req.body.password &&
        validateEmail(req.body.email)
      ) {
        const resetPasswordDeadline = new Date()
        resetPasswordDeadline.setTime(
          resetPasswordDeadline.getTime() + 3600 * 2 * 1000
        )
        const user = await User.findOne({
          where: {
            email: req.body.email.toLowerCase(),
            activationCode: req.body.code,
            requestedPasswordReset: { [Op.lt]: resetPasswordDeadline }
          }
        })
        if (user) {
          user.password = await bcrypt.hash(
            req.body.password,
            environment.saltRounds
          )
          user.activated = 1
          user.requestedPasswordReset = null
          user.save()
          success = true
        }
      }
    } catch (error) {
      console.error(error)
    }

    res.send({
      success
    })
  })

  app.post('/login', async (req, res) => {
    let success = false
    try {
      if (
        req.body &&
        req.body.email &&
        req.body.password &&
        req.body.captchaResponse &&
        (await checkCaptcha(req.body.captchaResponse, getIp(req)))
      ) {
        const userWithEmail = await User.findOne({
          where: { email: req.body.email.toLowerCase() }
        })
        if (userWithEmail) {
          const correctPassword = await bcrypt.compare(
            req.body.password,
            userWithEmail.password
          )
          if (correctPassword) {
            success = true
            if (userWithEmail.activated) {
              res.send({
                success: true,
                token: jwt.sign(
                  {
                    userId: userWithEmail.id,
                    email: userWithEmail.email.toLowerCase(),
                    birthDate: userWithEmail.birthDate,
                    url: userWithEmail.url
                  },
                  environment.jwtSecret,
                  { expiresIn: '31536000s' }
                )
              })
              userWithEmail.lastLoginIp = getIp(req)
              userWithEmail.save()
            } else {
              res.send({
                success: false,
                errorMessage: 'Please activate your account! Check your email'
              })
            }
          }
        }
      }
    } catch (error) {
      console.error(error)
    }

    if (!success) {
      // res.statusCode = 401;
      res.send({
        success: false,
        errorMessage: 'Please recheck your email and password'
      })
    }
  })

  app.get('/user', async (req, res) => {
    let success = false
    if (req.query && req.query.id) {
      const blogId: string = (req.query.id || '').toString().toLowerCase().trim()
      const blog = await User.findOne({
        attributes: {
          exclude: [
            'password',
            'birthDate',
            'email',
            'lastLoginIp',
            'registerIp',
            'activated',
            'activationCode',
            'requestedPasswordReset',
            'updatedAt',
            'createdAt',
            'lastTimeNotificationsCheck'
          ]
        },
        where: {
          url: sequelize.where(
            sequelize.fn('LOWER', sequelize.col('url')),
            'LIKE',
            blogId
          )
        }
      })
      success = blog
      if (success) {
        res.send(blog)
      }
    }

    if (!success) {
      res.send({ success: false })
    }
  })
}
