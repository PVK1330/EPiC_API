export default (sequelize, DataTypes) => {
  const LicenceDispatchDocument = sequelize.define(
    "LicenceDispatchDocument",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
        onDelete: "CASCADE",
      },
      senderUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sender_user_id",
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      senderRole: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "admin",
        field: "sender_role",
      },
      documentType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "supporting_document",
        field: "document_type",
      },
      documentName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "document_name",
      },
      filePath: {
        type: DataTypes.STRING(500),
        allowNull: false,
        field: "file_path",
      },
      fileName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "file_name",
      },
      fileSize: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "file_size",
      },
      mimeType: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "mime_type",
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      emailSent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "email_sent",
      },
      downloadedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "downloaded_at",
      },
    },
    {
      tableName: "licence_dispatch_documents",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return LicenceDispatchDocument;
};
