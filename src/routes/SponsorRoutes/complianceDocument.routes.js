import { Router } from 'express';
import multer from 'multer';
import {
    getComplianceDocuments,
    uploadComplianceDocument,
    deleteComplianceDocument
} from '../../controllers/SponsorControllers/complianceDocument.controller.js';

const router = Router();
const upload = multer({ dest: 'uploads/temp/' });

router.get('/', getComplianceDocuments);
router.post('/upload', upload.single('file'), uploadComplianceDocument);
router.delete('/:id', deleteComplianceDocument);

export default router;
