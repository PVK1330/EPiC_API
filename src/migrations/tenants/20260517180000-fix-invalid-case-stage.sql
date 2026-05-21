-- Normalise legacy invalid pipeline stage values
UPDATE cases SET "caseStage" = 'client_enquiry' WHERE "caseStage" = 'Initial';
UPDATE cases SET "caseStage" = 'client_enquiry' WHERE "caseStage" ILIKE 'initial' AND "caseStage" <> 'initial_consultation';
