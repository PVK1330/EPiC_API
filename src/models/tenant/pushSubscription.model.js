export default (sequelize, DataTypes) => {
  const PushSubscription = sequelize.define(
    "PushSubscription",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "user_id",
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      // Push-service URL unique to one browser subscription (FCM/Mozilla mint
      // one per browser+profile). Uniqueness makes re-subscribes an upsert.
      endpoint: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
      },
      // Client public key + auth secret from PushSubscription.getKey() —
      // required by the Web Push encryption (RFC 8291).
      p256dh: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      auth: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "user_agent",
      },
    },
    {
      tableName: "push_subscriptions",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return PushSubscription;
};
