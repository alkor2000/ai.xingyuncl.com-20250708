import common from './common.json'
import auth from './auth.json'
import chat from './chat.json'
import admin from './admin.json'
import errors from './errors.json'

export default {
  ...common,
  ...auth,
  ...chat,
  ...admin,
  ...errors
}
