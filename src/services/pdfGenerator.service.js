import PdfPrinter from "pdfmake";
import fs from "fs";

const fonts = {
  Roboto: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

function escapePdfText(text) {
  if (text === null || text === undefined) return "";
  return String(text).replace(/\r\n/g, "\n");
}

function normalizeRows(rows) {
  return (rows || []).map((r) => ({
    label: escapePdfText(r.label ?? ""),
    value: escapePdfText(r.value ?? "—"),
  }));
}

export function buildBrandedPdfDocDefinition({
  logoPath,
  title,
  sections,
  metadata,
}) {
  const website =
    metadata?.website ||
    process.env.PORTAL_WEBSITE_NAME ||
    "https://www.elitepic.co.uk/";
  const generatedAt =
    metadata?.generatedAtLabel ||
    new Date().toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

  const images = {};
  let hasLogo = false;
  if (logoPath && fs.existsSync(logoPath)) {
    const buf = fs.readFileSync(logoPath);
    images.logo = `data:image/png;base64,${buf.toString("base64")}`;
    hasLogo = true;
  }

  const content = [];

  if (hasLogo) {
    content.push({
      image: "logo",
      width: 220,
      alignment: "center",
      margin: [0, 0, 0, 14],
    });
  }

  content.push({
    text: escapePdfText(title),
    style: "docTitle",
    alignment: "center",
  });

  if (metadata?.subtitle) {
    content.push({
      text: escapePdfText(metadata.subtitle),
      style: "docSubtitle",
      alignment: "center",
      margin: [0, 6, 0, 4],
    });
  }

  const metaLines = [];
  if (metadata?.reference)
    metaLines.push({
      text: escapePdfText(metadata.reference),
      style: "metaLine",
    });
  if (metadata?.candidateName)
    metaLines.push({
      text: escapePdfText(metadata.candidateName),
      style: "metaLine",
    });
  metaLines.push({
    text: `Generated: ${generatedAt}`,
    style: "metaLine",
  });

  content.push({
    stack: metaLines,
    alignment: "center",
    margin: [0, 0, 0, 18],
  });

  const normalizedSections = sections || [];
  for (const section of normalizedSections) {
    const secTitle = section.sectionTitle || section.title;
    if (secTitle) {
      content.push({
        text: escapePdfText(secTitle),
        style: "sectionTitle",
        margin: [0, 12, 0, 8],
      });
    }

    const body = normalizeRows(section.rows).map((r) => [
      { text: r.label, style: "cellLabel", fillColor: "#f1f5f9" },
      { text: r.value, style: "cellValue" },
    ]);

    if (section.paragraphs && section.paragraphs.length) {
      for (const p of section.paragraphs) {
        content.push({
          text: escapePdfText(p),
          style: "paragraph",
          margin: [0, 0, 0, 8],
        });
      }
    }

    if (body.length) {
      content.push({
        table: {
          widths: ["34%", "*"],
          body,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#cbd5e1",
          vLineColor: () => "#cbd5e1",
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 10],
      });
    }
  }

  return {
    pageMargins: [48, 52, 48, 56],
    footer: (currentPage, pageCount) => ({
      margin: [48, 4, 48, 0],
      columns: [
        { text: website, style: "footerText", width: "*" },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          style: "footerText",
          alignment: "right",
          width: "auto",
        },
      ],
    }),
    content,
    images,
    styles: {
      docTitle: {
        fontSize: 18,
        bold: true,
        color: "#1e3a5f",
      },
      docSubtitle: {
        fontSize: 11,
        color: "#475569",
      },
      metaLine: {
        fontSize: 9,
        color: "#64748b",
        margin: [0, 2, 0, 0],
      },
      sectionTitle: {
        fontSize: 12,
        bold: true,
        color: "#1e293b",
        decoration: "underline",
        decorationColor: "#1d71b8",
      },
      cellLabel: {
        fontSize: 9,
        bold: true,
        color: "#334155",
      },
      cellValue: {
        fontSize: 9,
        color: "#1e293b",
      },
      paragraph: {
        fontSize: 9,
        color: "#334155",
        alignment: "justify",
      },
      footerText: {
        fontSize: 8,
        color: "#64748b",
      },
    },
    defaultStyle: {
      fontSize: 10,
      color: "#334155",
    },
  };
}

export function streamBrandedPdf(res, attachmentFilename, options) {
  const printer = new PdfPrinter(fonts);
  const docDefinition = buildBrandedPdfDocDefinition(options);
  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${attachmentFilename.replace(/"/g, "")}"`,
  );
  pdfDoc.on("error", (err) => {
    console.error("PDF stream error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        status: "error",
        message: err.message || "PDF generation failed",
        data: null,
      });
    }
  });
  pdfDoc.pipe(res);
  pdfDoc.end();
}
