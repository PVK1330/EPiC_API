export default (sequelize, DataTypes) => {
  const CaseNoteParticipant = sequelize.define(
    "CaseNoteParticipant",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      caseNoteId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'case_note_id',
        references: {
          model: 'case_notes',
          key: 'id',
        },
      },
      caseworkerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'caseworker_id',
        references: {
          model: 'users',
          key: 'id',
        },
      },
    },
    {
      tableName: 'case_note_participants',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        {
          unique: true,
          fields: ['case_note_id', 'caseworker_id'],
        },
        {
          fields: ['case_note_id'],
        },
        {
          fields: ['caseworker_id'],
        },
      ],
    }
  );

  return CaseNoteParticipant;
};
