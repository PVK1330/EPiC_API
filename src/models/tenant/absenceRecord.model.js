export default (sequelize, DataTypes) => {
  const AbsenceRecord = sequelize.define(
    "AbsenceRecord",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      workerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "worker_id",
        references: {
          model: "sponsored_workers",
          key: "id",
        },
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
      absenceType: {
        type: DataTypes.ENUM("annual_leave", "sick_leave", "unauthorised", "other"),
        allowNull: false,
        field: "absence_type",
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: "start_date",
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: "end_date",
      },
      totalWorkingDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "total_working_days",
      },
      attendanceRecordPath: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "attendance_record_path",
      },
      reportedToSms: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "reported_to_sms",
      },
      reportingRequired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "reporting_required",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "absence_records",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return AbsenceRecord;
};
