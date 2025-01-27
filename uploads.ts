import multer from 'multer'
import generateRandomString from './utils/generateRandomString'
const environment = require('./environment')

const imageStorage = multer.diskStorage({
  // Destination to store image
  destination: 'uploads',
  filename: (req, file, cb) => {
    const originalNameArray = file.originalname.split('.')
    const extension = originalNameArray[originalNameArray.length - 1]
    const randomText = generateRandomString()
    cb(null, `${Date.now()}_${randomText}.${extension.toLocaleLowerCase()}`)
  }
})

const uploadHandler = multer({
  storage: imageStorage,
  limits: {
    fileSize: environment.uploadSize * 1024 * 1024 // 15 MB.
  },
  fileFilter (req, file, cb) {
    const name = file.originalname.toLowerCase()
    const isFileAllowed = !(name.match(/\.(png|jpg|jpeg|gifv|gif|webp|mp4|mov|webm|mkv)$/) == null)
    cb(null, isFileAllowed)
  }
})

export default uploadHandler
