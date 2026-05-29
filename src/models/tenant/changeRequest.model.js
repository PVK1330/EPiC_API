export default (sequelize, DataTypes) => {
  const ChangeRequest = sequelize.define('ChangeRequest', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    entity_type: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    entity_id: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    case_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'cases', key: 'id' }
    },
    field_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    old_value: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    requested_value: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    change_category: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    risk_level: {
      type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ESCALATED', 'COMPLETED'),
      defaultValue: 'SUBMITTED',
      allowNull: false
    },
    submitted_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' }
    },
    reviewed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' }
    },
    review_notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    organisation_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'organisations', key: 'id' }
    }
  }, {
    tableName: 'change_requests',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return ChangeRequest;
};
