export default (sequelize, DataTypes) => {
  const SponsoredWorkerAudit = sequelize.define(
    "SponsoredWorkerAudit",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sponsoredWorkerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sponsored_worker_id",
        references: { model: "sponsored_workers", key: "id" },
        onDelete: "CASCADE",
      },
      action: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },
      fromStatus: {
        type: DataTypes.STRING(60),
        allowNull: true,
        field: "from_status",
      },
      toStatus: {
        type: DataTypes.STRING(60),
        allowNull: false,
        field: "to_status",
      },
      actorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "actor_id",
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "sponsored_worker_audits",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );

  return SponsoredWorkerAudit;
};
