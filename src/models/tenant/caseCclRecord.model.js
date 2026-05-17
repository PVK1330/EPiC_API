export default (sequelize, DataTypes) => {
  const CaseCclRecord = sequelize.define(
    "CaseCclRecord",
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      caseId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: "case_id" },
      status: {
        type: DataTypes.ENUM("pending", "issued", "signed"),
        allowNull: false,
        defaultValue: "pending",
      },
      issuedDocumentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "issued_document_id",
      },
      signedDocumentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "signed_document_id",
      },
      feeAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: "fee_amount",
      },
      issuedAt: { type: DataTypes.DATE, allowNull: true, field: "issued_at" },
      signedAt: { type: DataTypes.DATE, allowNull: true, field: "signed_at" },
      issuedBy: { type: DataTypes.INTEGER, allowNull: true, field: "issued_by" },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "case_ccl_records",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );
  return CaseCclRecord;
};
