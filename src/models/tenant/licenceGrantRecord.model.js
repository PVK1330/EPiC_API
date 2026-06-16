export default (sequelize, DataTypes) => {
  const LicenceGrantRecord = sequelize.define(
    "LicenceGrantRecord",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
        onDelete: "CASCADE",
      },
      licenceNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "licence_number",
      },
      approvedById: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "approved_by_id",
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      grantDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "grant_date",
      },
      expiryDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "expiry_date",
      },
      sponsorType: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "sponsor_type",
      },
      rating: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "A",
      },
      cosAllocation: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "cos_allocation",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "licence_grant_records",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceGrantRecord;
};
