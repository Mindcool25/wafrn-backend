import { Application } from 'express'
import { Op } from 'sequelize'
import { Post, PostMentionsUserRelation, User } from '../models'
import authenticateToken from '../utils/authenticateToken'
import getBlockedIds from '../utils/getBlockedIds'
import getReblogs from '../utils/getReblogs'

export default function notificationRoutes (app: Application) {
  app.post('/readNotifications', authenticateToken, async (req: any, res) => {
    try {
      const userId = req.jwtData.userId
      const user = await User.findOne({
        where: {
          id: userId
        }
      })
      if (req.body.time) {
        user.lastTimeNotificationsCheck = new Date().setTime(req.body.time)
        user.save()
      }
    } catch (error) {
      console.error(error)
    }
    res.send({
      success: true
    })
  })

  app.get('/notifications', authenticateToken, async (req: any, res) => {
    const userId = req.jwtData.userId
    const user = await User.findOne({
      where: {
        id: userId
      }
    })
    const blockedUsers = await getBlockedIds(userId)
    const perPostReblogs = getReblogs(user)
    const newFollows = user.getFollower({
      where: {
        createdAt: {
          [Op.gt]: new Date(user.lastTimeNotificationsCheck)
        }
      },
      attributes: ['url', 'avatar']
    })
    const newMentions = PostMentionsUserRelation.findAll({
      where: {
        createdAt: {
          [Op.gt]: new Date(user.lastTimeNotificationsCheck)
        },
        userId
      },
      include: [
        {
          model: Post,
          include: [
            {
              model: User,
              attributes: ['avatar', 'url', 'description', 'id']
            }
          ]
        }
      ]
    })
    res.send({
      follows: (await newFollows).filter(
        (newFollow: any) => !blockedUsers.includes(newFollow.id)
      ),
      reblogs: (await perPostReblogs).filter(
        (newReblog: any) => !blockedUsers.includes(newReblog.user.id)
      ),
      mentions: (await newMentions)
        .filter((newMention: any) => {
          return !blockedUsers.includes(newMention.post.userId)
        })
        .map((mention: any) => {
          return {
            user: mention.post.user,
            content: mention.post.content,
            id: mention.post.id,
            createdAt: mention.createdAt,
            parentId: mention.post.parentId
          }
        })
    })
  })
}
