export default (sequelize, DataTypes) => {
  const SponsoredWorker = sequelize.define(
    "SponsoredWorker",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      cosRequestId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "cos_request_id",
        references: { model: "cos_requests", key: "id" },
        onDelete: "SET NULL",
      },
      cosAllocationRecordId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "cos_allocation_record_id",
        references: { model: "cos_allocation_records", key: "id" },
        onDelete: "SET NULL",
      },
      sponsorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sponsor_id",
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
        onDelete: "SET NULL",
      },
      workerFirstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "worker_first_name",
      },
      workerLastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "worker_last_name",
      },
      workerEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "worker_email",
      },
      workerNationality: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "worker_nationality",
      },
      visaType: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "visa_type",
      },
      status: {
        type: DataTypes.STRING(60),
        allowNull: false,
        defaultValue: "CoS Assigned",
      },
      assignedCaseworkerIds: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "assigned_caseworker_ids",
        defaultValue: [],
      },
      rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "rejection_reason",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "sponsored_workers",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      paranoid: true,
      deletedAt: "deleted_at",
    }
  );

  return SponsoredWorker;
};
