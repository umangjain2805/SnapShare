import { User, Session } from './model.js';
export const authRepository = {
  findByEmail: (email: string) => User.findOne({ email }).select('+passwordHash'),
  createUser: (data: { name: string; email: string; passwordHash: string }) => User.create(data),
  deleteUser: (id: string) => User.deleteOne({ _id: id }),
  createSession: (userId: string, tokenHash: string, expiresAt: Date) => Session.create({ userId, tokenHash, expiresAt }),
  findSession: (tokenHash: string) => Session.findOne({ tokenHash, expiresAt: { $gt: new Date() } }),
  findUser: (id: string) => User.findById(id),
  deleteSession: (tokenHash: string) => Session.deleteOne({ tokenHash }),
};
