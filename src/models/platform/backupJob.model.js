export default (sequelize, DataTypes) => {
  const BackupJob = sequelize.define(
    "BackupJob",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      kind: { type: DataTypes.STRING(20), allowNull: false },
      scope: { type: DataTypes.STRING(20), allowNull: false },
      organisation_id: { type: DataTypes.INTEGER, allowNull: true },
      database_name: { type: DataTypes.STRING(63), allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pending" },
      stage: { type: DataTypes.STRING(50), allowNull: true },
      // Server-side path only; never serialised to clients.
      file_path: { type: DataTypes.TEXT, allowNull: true },
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      file_size: { type: DataTypes.BIGINT, allowNull: true },
      checksum: { type: DataTypes.STRING(64), allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      meta: { type: DataTypes.JSONB, allowNull: true },
      requested_by: { type: DataTypes.INTEGER, allowNull: true },
      requested_by_role: { type: DataTypes.INTEGER, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "backup_jobs", timestamps: false },
  );
  return BackupJob;
};
