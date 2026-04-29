export default (sequelize, DataTypes) => {
  const DocumentChecklist = sequelize.define(
    "DocumentChecklist",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      visaTypeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'visa_type_id',
        references: {
          model: 'visa_types',
          key: 'id'
        },
        comment: "Visa type this checklist applies to"
      },
      documentType: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'document_type',
        comment: "Type of document required (e.g., Passport, English Certificate)"
      },
      documentName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'document_name',
        comment: "Display name for the document in checklist"
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'description',
        comment: "Description or requirements for this document"
      },
      isRequired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_required',
        comment: "Whether this document is mandatory or optional"
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'sort_order',
        comment: "Order in which to display in checklist"
      },
      category: {
        type: DataTypes.ENUM('identity', 'education', 'work', 'financial', 'medical', 'legal', 'other'),
        allowNull: false,
        defaultValue: 'other',
        field: 'category',
        comment: "Category for grouping documents"
      }
    },
    {
      tableName: 'document_checklists',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      sync: false, // Disable auto-sync since table is managed by migration
      indexes: [
        {
          fields: ['visa_type_id']
        },
        {
          fields: ['document_type']
        },
        {
          fields: ['category']
        }
      ]
    }
  );

  return DocumentChecklist;
};
