import mongoose from 'mongoose';
export async function connectDatabase(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
}
export const disconnectDatabase = () => mongoose.disconnect();
