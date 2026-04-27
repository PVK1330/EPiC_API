const AppointmentModel = (sequelize, DataTypes) => {
  const Appointment = sequelize.define(
    "Appointment",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      case_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "cases",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      candidate_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      caseworker_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      time: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      platform: {
        type: DataTypes.ENUM("teams", "meet", "zoom", "in-person"),
        defaultValue: "teams",
        allowNull: false,
      },
      meeting_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("scheduled", "completed", "cancelled", "live"),
        defaultValue: "scheduled",
        allowNull: false,
      },
      invited_staff: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
        comment: "Array of additional staff user IDs invited to the meeting",
      },
    },
    {
      tableName: "appointments",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Appointment;
};

export default AppointmentModel;
