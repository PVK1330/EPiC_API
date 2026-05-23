export default (sequelize, DataTypes) => {
  const CaseNote = sequelize.define(
    "CaseNote",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      caseId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'cases',
          key: 'id'
        }
      },
      noteType: {
        type: DataTypes.ENUM('internal', 'client_communication', 'legal_note', 'reminder', 'follow_up'),
        allowNull: false,
        defaultValue: 'internal',
        comment: "Type of note"
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Title of the note"
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "Content of the note"
      },
      authorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        comment: "User who created the note"
      },
      visibility: {
        type: DataTypes.ENUM('private', 'team', 'admin_only', 'all_staff'),
        allowNull: false,
        defaultValue: 'team',
        comment: "Visibility level of the note"
      },
      isPinned: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Whether this note is pinned"
      },
      isArchived: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Whether this note is archived"
      },
      reminderDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: "Date for reminder if applicable"
      },
      reminderSent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Whether reminder has been sent"
      },
      tags: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Array of tags for categorization"
      },
      attachments: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Array of attachment file paths"
      },
      parentNoteId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'case_notes',
          key: 'id'
        },
        comment: "Parent note for threaded conversations"
      },
    },
    {
      tableName: 'case_notes',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  );

  return CaseNote;
};
