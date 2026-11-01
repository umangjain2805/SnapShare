import { AppError } from '../../middleware/errors.js';
import { notificationRepository as repo } from './repository.js';
export function createNotificationService() {
  return {
    async list(ownerId: string, before?: string) {
      const [notifications, unreadCount] = await Promise.all([repo.list(ownerId, before), repo.unread(ownerId)]);
      return { notifications: notifications.slice(0, 50).map(n => ({ id: n.id as string, message: n.message, shareId: n.shareId, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null, emailStatus: n.emailStatus })), unreadCount, nextCursor: notifications.length > 50 ? notifications[49]!.id as string : null };
    },
    async read(ownerId: string, id: string) { if (!await repo.read(ownerId, id)) throw new AppError(404, 'Notification not found'); },
  };
}
