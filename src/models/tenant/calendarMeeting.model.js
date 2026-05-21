export default (sequelize, DataTypes) => {
  const CalendarMeeting = sequelize.define(
    "CalendarMeeting",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      subject: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      start_time: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      end_time: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      attendees: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
      },
      meeting_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "online",
      },
      reminder_minutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 15,
      },
      related_case_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      join_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("scheduled", "cancelled"),
        allowNull: false,
        defaultValue: "scheduled",
      },
      event_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "teams",
      },
      location: {
        type: DataTypes.STRING(500),
        allowNull: true,
        defaultValue: "",
      },
    },
    {
      tableName: "calendar_meetings",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return CalendarMeeting;
};
