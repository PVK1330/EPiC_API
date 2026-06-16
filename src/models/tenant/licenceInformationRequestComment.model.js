export default (sequelize, DataTypes) => {
  const LicenceInformationRequestComment = sequelize.define(
    "LicenceInformationRequestComment",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenceInformationRequestId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "licence_information_request_id",
        references: { model: "licence_information_requests", key: "id" },
        onDelete: "CASCADE",
      },
      authorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "author_id",
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      // caseworker | admin | sponsor
      authorRole: {
        type: DataTypes.STRING(20),
        allowNull: false,
        field: "author_role",
      },
      comment: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // TRUE = internal staff note, never sent to the sponsor
      isInternal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "is_internal",
      },
    },
    {
      tableName: "licence_information_request_comments",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return LicenceInformationRequestComment;
};
