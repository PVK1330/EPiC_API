export default (sequelize, DataTypes) => {
  const CaseTimeline = sequelize.define(
    "CaseTimeline",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      caseId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'case_id',
        references: {
          model: 'cases',
          key: 'id'
        }
      },
      actionType: {
        type: DataTypes.ENUM(
          'case_created',
          'case_updated',
          'status_changed',
          'document_uploaded',
          'document_reviewed',
          'payment_received',
          'payment_recorded',
          'note_added',
          'communication_sent',
          'communication_received',
          'assignment_changed',
          'deadline_updated',
          'reminder_sent',
          'case_closed',
          'case_reopened'
        ),
        allowNull: false,
        field: 'action_type',
        comment: "Type of action performed"
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "Description of the action"
      },
      performedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'performed_by',
        references: {
          model: 'users',
          key: 'id'
        },
        comment: "User who performed the action"
      },
      actionDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'action_date',
        comment: "Date when the action was performed"
      },
      previousValue: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'previous_value',
        comment: "Previous value before the change"
      },
      newValue: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'new_value',
        comment: "New value after the change"
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Additional metadata about the action"
      },
      isSystemAction: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_system_action',
        comment: "Whether this was a system-generated action"
      },
      visibility: {
        type: DataTypes.ENUM('public', 'internal', 'admin_only'),
        allowNull: false,
        defaultValue: 'public',
        field: 'visibility',
        comment: "Visibility level of this timeline entry"
      },
    },
    {
      tableName: 'case_timeline',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  );

  return CaseTimeline;
};
