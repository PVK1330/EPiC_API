export default (sequelize, DataTypes) => {
  const LicenceInformationRequest = sequelize.define(
    "LicenceInformationRequest",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
        onDelete: "CASCADE",
      },
      requestedById: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "requested_by_id",
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      resolvedById: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "resolved_by_id",
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      // open | responded | closed
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "open",
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      details: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      requestedDocuments: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        field: "requested_documents",
      },
      sponsorResponse: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "sponsor_response",
      },
      requestedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "requested_at",
      },
      respondedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "responded_at",
      },
      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "closed_at",
      },
    },
    {
      tableName: "licence_information_requests",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return LicenceInformationRequest;
};
