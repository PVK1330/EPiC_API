export default (sequelize, DataTypes) => {
  const EsignatureRequest = sequelize.define(
    'EsignatureRequest',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      case_id: { type: DataTypes.INTEGER, allowNull: true },
      document_id: { type: DataTypes.INTEGER, allowNull: true },
      requested_by: { type: DataTypes.INTEGER, allowNull: false },
      signer_id: { type: DataTypes.INTEGER, allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.ENUM('pending', 'signed', 'declined', 'expired'),
        allowNull: false,
        defaultValue: 'pending',
      },
      token: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      signed_at: { type: DataTypes.DATE, allowNull: true },
      declined_at: { type: DataTypes.DATE, allowNull: true },
      decline_reason: { type: DataTypes.TEXT, allowNull: true },
      signature_data: { type: DataTypes.TEXT, allowNull: true },
      signature_type: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'drawn',
      },
      ip_address: { type: DataTypes.STRING(45), allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'esignature_requests',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return EsignatureRequest;
};
