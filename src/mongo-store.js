export function mongoStore(db) {
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  const profiles = db.collection('profiles');
  return {
    async initialize() {
      await users.createIndex({ email: 1 }, { unique: true });
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await sessions.createIndex({ userId: 1 });
    },
    findUser(email) {
      return users.findOne({ email });
    },
    findUserById(id) {
      return users.findOne({ _id: id });
    },
    async addUser(user) {
      try {
        await users.insertOne(user);
        return true;
      } catch (error) {
        if (error?.code === 11000) return false;
        throw error;
      }
    },
    saveSession(session) {
      return sessions.insertOne(session);
    },
    findSession(digest, now) {
      return sessions.findOne({ _id: digest, expiresAt: { $gt: now } });
    },
    deleteSession(digest) {
      return sessions.deleteOne({ _id: digest });
    },
    getProfile(userId) {
      return profiles.findOne({ _id: userId });
    },
    saveProfile(userId, profile) {
      return profiles.replaceOne({ _id: userId }, { _id: userId, ...profile }, { upsert: true });
    },
  };
}
