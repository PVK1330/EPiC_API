const RescheduleHistoryModel = (sequelize, DataTypes) => {
  const RescheduleHistory = sequelize.define("RescheduleHistory", {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'cases',
        key: 'id'
      }
    },
    fieldName: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "Name of the field being rescheduled (e.g., targetSubmissionDate, biometricsDate)"
    },
    oldValue: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Previous date value"
    },
    newValue: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "New date value"
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Reason for reschedule"
    },
    createdById: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: "User ID who performed the reschedule"
    },
  }, {
    tableName: 'reschedule_history',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  return RescheduleHistory;
};

export default RescheduleHistoryModel;
