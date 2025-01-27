import { Request, Response, NextFunction } from 'express'
import { User } from '../models';
import { signedGetPetition } from '../routes/activitypub';
const environment = require('../environment')
var httpSignature = require('@peertube/http-signature');

const user = User.findOne({
  where: {
    url: environment.adminUser
  }
}) 
export default async function checkFediverseSignature (
  req: Request,
  res: Response,
  next: NextFunction
) {
  let success = false
  const digest = req.headers.digest
  const signature = req.headers.signature
  if (digest && signature) {
    // TODO check signatures for the love of god
    success = false
    try {
      const sigHead = httpSignature.parse(req)
      // posible optimization: cache the key. Also we need an user to sign the petition
      const keyPetitionResponse = await signedGetPetition(await user, sigHead.keyId)
      const remoteKey = keyPetitionResponse.publicKey.publicKeyPem
      // TODO still not finished
      success = true
      //success = httpSignature.verifySignature(sigHead,  remoteKey)

    } catch (error) {
      console.log('Error while parsing.')
      // success = true
    }
  }
  if (!success) {
    return res.sendStatus(403)
  } else {
    next()
  }
}
