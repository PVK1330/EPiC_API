export default (sequelize, DataTypes) => {
  /**
   * Certificate of Sponsorship (CoS) allocation request.
   *
   * Single source of truth for the CoS workflow:
   *   Pending -> Under Review -> Approved | Rejected -> allocation updated.
   *
   * Replaces the previous approach of storing CoS requests as LicenceApplication
   * rows with a "CoS Request:" reason prefix (which caused real licence
   * applications and CoS requests to be conflated).
   */
  const CosRequest = sequelize.define(
    "CosRequest",
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
        references: { model: "users", key: "id" },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
      },
      visaType: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "visa_type",
      },
      requestedAmount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "requested_amount",
      },
      approvedAmount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "approved_amount",
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Pending | Under Review | Approved | Rejected (validated in the service).
      status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "Pending",
      },
      // Caseworker(s) assigned to review this request (admin assignment step).
      assignedCaseworkerIds: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "assigned_caseworker_ids",
      },
      reviewNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "review_notes",
      },
      reviewedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "reviewed_by",
        references: { model: "users", key: "id" },
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "reviewed_at",
      },
    },
    {
      tableName: "cos_requests",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return CosRequest;
};
