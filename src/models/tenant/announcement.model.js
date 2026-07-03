export default (sequelize, DataTypes) => {
  const Announcement = sequelize.define(
    "Announcement",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // Audience roles this announcement was sent to (caseworker/sponsor/candidate).
      target_roles: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      recipients: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      send_email: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      created_by_name: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
    },
    {
      tableName: "announcements",
      timestamps: true,
      indexes: [{ fields: ["createdAt"] }],
    },
  );

  return Announcement;
};
