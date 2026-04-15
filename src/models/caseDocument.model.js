export default (sequelize, DataTypes) => {
  const CaseDocument = sequelize.define(
    "CaseDocument",
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
      documentType: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: "Type of document (e.g., Passport, Resume, Contract)"
      },
      documentName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "Name of the document file"
      },
      documentPath: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: "Path to the stored document file"
      },
      documentCategory: {
        type: DataTypes.ENUM('candidate', 'business'),
        allowNull: false,
        defaultValue: 'candidate',
        comment: "Category of the document"
      },
      status: {
        type: DataTypes.ENUM('missing', 'uploaded', 'under_review', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'missing',
        comment: "Current status of the document"
      },
      expiryDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: "Document expiry date for alerts"
      },
      uploadedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        comment: "User who uploaded the document"
      },
      uploadedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Timestamp when document was uploaded"
      },
      reviewedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        comment: "User who reviewed the document"
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Timestamp when document was reviewed"
      },
      reviewNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Notes from document review"
      },
      isRequired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether this document is required for the case"
      },
    },
    {
      tableName: 'case_documents',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  );

  return CaseDocument;
};
