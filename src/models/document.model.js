export default (sequelize, DataTypes) => {
  const Document = sequelize.define(
    "Document",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      caseId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'cases',
          key: 'id'
        },
        comment: "Optional case association if document is case-related"
      },
      documentType: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: "Type of document (e.g., Passport, Resume, Contract)"
      },
      documentName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "Original name of the uploaded document file"
      },
      userFileName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Filename provided by user in payload"
      },
      documentPath: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: "Path to the stored document file (uploads/documentCategory/userId/documentpath)"
      },
      documentCategory: {
        type: DataTypes.ENUM('candidate', 'business', 'personal', 'legal', 'financial', 'other'),
        allowNull: false,
        defaultValue: 'candidate',
        comment: "Category of the document for folder organization"
      },
      mimeType: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: "MIME type of the uploaded file"
      },
      fileSize: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "File size in bytes"
      },
      status: {
        type: DataTypes.ENUM('missing', 'uploaded', 'under_review', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'uploaded',
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
        defaultValue: false,
        comment: "Whether this document is required for the case"
      },
      tags: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Tags for document categorization and search"
      }
    },
    {
      tableName: 'documents',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        {
          fields: ['userId']
        },
        {
          fields: ['caseId']
        },
        {
          fields: ['documentCategory']
        },
        {
          fields: ['status']
        }
      ]
    }
  );

  return Document;
};

