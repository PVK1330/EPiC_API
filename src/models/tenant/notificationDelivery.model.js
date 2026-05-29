export default (sequelize, DataTypes) => {
  const NotificationDelivery = sequelize.define(
    "NotificationDelivery",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      notificationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "notification_id",
        references: {
          model: "notifications",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      emailSent: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "email_sent",
      },
      emailSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "email_sent_at",
      },
      socketDelivered: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "socket_delivered",
      },
      socketDeliveredAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "socket_delivered_at",
      },
      viewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "viewed_at",
      },
      deliveryStatus: {
        type: DataTypes.ENUM("pending", "delivered", "failed", "viewed"),
        defaultValue: "pending",
        field: "delivery_status",
      },
    },
    {
      tableName: "notification_deliveries",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["notification_id"] },
        { fields: ["delivery_status"] },
      ],
    }
  );

  return NotificationDelivery;
};
