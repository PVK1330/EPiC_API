export default (sequelize, DataTypes) => {
  const DataCaptureSubmission = sequelize.define(
    "DataCaptureSubmission",
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      caseId: { type: DataTypes.INTEGER, allowNull: false, field: "case_id" },
      userId: { type: DataTypes.INTEGER, allowNull: false, field: "user_id" },
      templateId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "template_id",
      },
      responses: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: {
        type: DataTypes.ENUM("draft", "submitted", "approved", "rejected"),
        allowNull: false,
        defaultValue: "draft",
      },
      reviewNotes: { type: DataTypes.TEXT, allowNull: true, field: "review_notes" },
      submittedAt: { type: DataTypes.DATE, allowNull: true, field: "submitted_at" },
    },
    {
      tableName: "data_capture_submissions",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );
  return DataCaptureSubmission;
};
