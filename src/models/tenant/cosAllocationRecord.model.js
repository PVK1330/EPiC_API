export default (sequelize, DataTypes) => {
  const CosAllocationRecord = sequelize.define(
    "CosAllocationRecord",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      cosRequestId: {
        type: DataTypes.INTEGER,
        allowNull: true,   // NULL for initial licence-grant allocations (no request)
        unique: true,
        field: "cos_request_id",
        references: { model: "cos_requests", key: "id" },
        onDelete: "CASCADE",
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
      allocationNumber: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        field: "allocation_number",
      },
      visaType: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "visa_type",
      },
      allocatedAmount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "allocated_amount",
      },
      allocatedById: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "allocated_by_id",
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      allocatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "allocated_at",
      },
      expiryDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "expiry_date",
      },
      // 'Active' only until Phase 5 (worker management) wires Used / Expired / Revoked.
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "Active",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "cos_allocation_records",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return CosAllocationRecord;
};
