import { User, Session, UploadSession, Snippet, AssetQuota, Share, TransferTicket, OutboxEvent, Notification } from './index.js';
export const initializeModels = () => Promise.all([User.init(), Session.init(), UploadSession.init(), Snippet.init(), AssetQuota.init(), Share.init(), TransferTicket.init(), OutboxEvent.init(), Notification.init()]);
