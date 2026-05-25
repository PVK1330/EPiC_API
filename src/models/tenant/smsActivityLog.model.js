export default (sequelize, DataTypes) => {
  const SmsActivityLog = sequelize.define(
    "SmsActivityLog",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sponsorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sponsor_id",
        references: {
          model: "users",
          key: "id",
        },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: {
          model: "organisations",
          key: "id",
        },
      },
      eventType: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "event_type",
      },
      dateSubmitted: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "date_submitted",
      },
      smsReferenceNumber: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "sms_reference_number",
      },
      screenshotPath: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "screenshot_path",
      },
      submittedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "submitted_by",
        references: {
          model: "users",
          key: "id",
        },
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "sms_activity_logs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return SmsActivityLog;
};
