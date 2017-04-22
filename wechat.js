const {Wechaty} = require('wechaty'),
    EventEmitter = require('events'),
    QrcodeTerminal  = require('qrcode-terminal'),
    crypto  = require('crypto'),
    decode = require('decode-html');
import {Message, Room, Contact} from 'wechaty'

const AppMsgType = {
  TEXT                     : 1,
  IMG                      : 2,
  AUDIO                    : 3,
  VIDEO                    : 4,
  URL                      : 5,
  ATTACH                   : 6,
  OPEN                     : 7,
  EMOJI                    : 8,
  VOICE_REMIND             : 9,
  SCAN_GOOD                : 10,
  GOOD                     : 13,
  EMOTION                  : 15,
  CARD_TICKET              : 16,
  REALTIME_SHARE_LOCATION  : 17,
  TRANSFERS                : 2e3,
  RED_ENVELOPES            : 2001,
  READER_TYPE              : 100001,
}

const MsgType = {
  TEXT                : 1,
  IMAGE               : 3,
  VOICE               : 34,
  VERIFYMSG           : 37,
  POSSIBLEFRIEND_MSG  : 40,
  SHARECARD           : 42,
  VIDEO               : 43,
  EMOTICON            : 47,
  LOCATION            : 48,
  APP                 : 49,
  VOIPMSG             : 50,
  STATUSNOTIFY        : 51,
  VOIPNOTIFY          : 52,
  VOIPINVITE          : 53,
  MICROVIDEO          : 62,
  SYSNOTICE           : 9999,
  SYS                 : 10000,
  RECALLED            : 10002,
}

class WechatIntegrationApi extends shim {
    constructor (commandPrefix, api) {
        super(commandPrefix);
        this._baseApi = api;
        this._threadInfo = {};
        this._endTyping = null;
    }

    _stopTyping () {
        if (this._endTyping) {
            this._endTyping();
            this._endTyping = null;
        }
    }

    sendMessage (message, thread) {
        this._stopTyping();
        LOG.info('wechatThread:'+thread)
        try{
            Room.find({ topic: thread }).then(
                room=>{
                    if(room){
                        room.say(message)
                    }
                });
        }catch(err){
            LOG.warn('[Wechat]'+err)
        }
        try{
            Contact.find({ alias: thread }).then(
                contact=>{
                    if(contact){
                        contact.say(message)
                    }
                });
        }catch(err){
            LOG.warn('[Wechat]'+err)
        }

                
    }

    sendUrl (url, thread) {
        this._stopTyping();
        // this._baseApi.sendMessage({body: url, url: url}, thread);
    }

    sendImage (type, image, description, thread) {
        this._stopTyping();
    }

    sendFile (...args) {
    }

    sendTyping (thread) {
    }

    setTitle (title, thread) {
    }

    getUsers (thread) {
        LOG.info('in get user'+thread)
        return thread.room() ? thread.room() : thread.from();
    }

    _wechatLogout() {
        // this._baseApi.logout();
        this._baseApi = null;
    }
}

class WechatIntegration extends EventEmitter {
    constructor () {
        super();
        this._unknownIter = 1;
        this._stopListeningMethod = null;
        this._integrationApi = null;
        this._bot = null;
    }

    _getSenderInfo (ids, api, event, finished) {
        const threadInfo = this._integrationApi.getUsers();
        const callback = (err, info) => {
            if (err) {
                return finished(`<Unknown User ${this._unknownIter++}>`);
            }
            for (let id in info) {
                threadInfo[event.threadID][id] = {
                    id: id,
                    name: info[id].name,
                    email: 'unknown@foo.bar'
                };
            }
            return finished(threadInfo[event.threadID][event.senderID].name);
        };
        api.getUserInfo(ids, callback);
    }

    _getSenderName (api, event, finished) {
        const threadInfo = this._integrationApi.getUsers();
        if (threadInfo[event.threadID] && threadInfo[event.threadID][event.senderID]) {
            return finished(threadInfo[event.threadID][event.senderID].name);
        }

        if (!threadInfo[event.threadID]) {
            threadInfo[event.threadID] = {};
            api.getThreadInfo(event.threadID, (err, info) => {
                if (err) {
                    return finished(`<Unknown User ${this._unknownIter++}>`);
                }
                this._getSenderInfo(info.participantIDs, api, event, finished);
            });
        }
        else {
            this._getSenderInfo([event.senderID], api, event, finished);
        }
    }

    getApi () {
        return this._integrationApi;
    }

    start (callback) {
        this._bot = Wechaty.instance();
        this._integrationApi = new WechatIntegrationApi(this.config.commandPrefix, this._bot);
        this._bot.on('message', m=>{
            if(m.self()){ 
                LOG.info('receive:'+m.content());
                return 
            }
            
            if(!m.from().alias()){
                m.from().alias(crypto.createHmac('sha256', 'Ring_bind_alias_user_'+Date.now()+m.from().name()).digest('hex'))
                LOG.info('set alias for user:'+m.from().name()+' => '+m.from().alias())
            }

            switch(m.type()){
                case MsgType.TEXT: //text                    

                    const data = shim.createEvent(m.room()?m.room().topic():m.from().alias(), m.from().alias(), m.from().name(), m.content() + '');
                    callback(this._integrationApi, data);
                case MsgType.APP:
                    switch(m.typeApp()){
                        case AppMsgType.URL:
                        case AppMsgType.READER_TYPE:
                            if (m.rawObj&&m.rawObj.Url) {
                                const data = shim.createEvent(m.room()?m.room().alias():m.from().alias(), m.from().alias(), m.from().name(), '\n'+m.rawObj.MMAppMsgDesc+ '\n'+decode(m.rawObj.Url));
                                callback(this._integrationApi, data);
                            }else{
                                LOG.warn('The Msg format is not supported.')
                            }
                            break;
                        default:
                    }
                    break;
                default:
                    LOG.info('event type unhandled!:');

                    break;
            }
        });
        this._bot.on('logout'   , user => LOG.info('Bot', `${user.name()} logouted`))
        .on('login'   , user => {
          LOG.info('Bot', `${user.name()} logined`)
          this._bot.say('Wechaty login')
        })
        .on('error'   , e => {
          LOG.info('Bot', 'error: %s', e)
          this._bot.say('Wechaty error: ' + e.message)
        })
        .on('scan', (url, code) => {
          if (!/201|200/.test(String(code))) {
            let loginUrl = url.replace(/\/qrcode\//, '/l/')
            LOG.info('Generating QR Code...')      
            QrcodeTerminal.generate(loginUrl, function (qrcode){
                LOG.info('Scan QR Code below to login: \n'+qrcode)      
            })
          }
        })
        this._bot.init()
        .catch(e => {
          LOG.error('Bot', 'init() fail: %s', e)
          this._bot.quit()
          process.exit(-1)
        })
    }

    stop () {
        LOG.error('Wechat Integration can\' logout automatically!!!')
    }
}

module.exports = new WechatIntegration();