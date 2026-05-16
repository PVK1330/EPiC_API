export default (sequelize, DataTypes) => {
  const WorkerEvent = sequelize.define(
    "WorkerEvent",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sponsorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      workerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      caseId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "cases",
          key: "id",
        },
      },
      eventType: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      eventDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      reportedDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      deadlineDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "reported", "overdue"),
        allowNull: false,
        defaultValue: "pending",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "worker_events",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return WorkerEvent;
};
