import { Notification } from '@snapshare/backend';
export const notificationRepository = {
  list: (ownerId: string, before?: string) => Notification.find({ ownerId, ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(51),
  unread: (ownerId: string) => Notification.countDocuments({ ownerId, readAt: { $exists: false } }),
  read: (ownerId: string, id: string) => Notification.findOneAndUpdate({ _id: id, ownerId }, { $set: { readAt: new Date() } }, { new: true }),
};
