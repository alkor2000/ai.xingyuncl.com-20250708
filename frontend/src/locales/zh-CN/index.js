import common from './common.json'
import profile from './profile.json'
import auth from './auth.json'
import chat from './chat.json'
import admin from './admin.json'
import errors from './errors.json'
import storage from './storage.json'

export default {
  ...common,
  ...profile,
  ...auth,
  ...chat,
  ...admin,
  ...errors,
  ...storage
}
