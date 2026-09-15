$word = New-Object -ComObject Word.Application
$word.Visible = $false
$docxPath = "C:\Users\pkk22\OneDrive\Desktop\TECHNOWEB\CMS_Admin\EPiC_API\Server\CCL_Generation_and_Caseworker_Template_Management_Guide.docx"
$pdfPath = "C:\Users\pkk22\OneDrive\Desktop\TECHNOWEB\CMS_Admin\EPiC_API\Server\CCL_Generation_and_Caseworker_Template_Management_Guide.pdf"
$doc = $word.Documents.Open($docxPath)
$doc.SaveAs([ref]$pdfPath, [ref]17)
$doc.Close()
$word.Quit()
Write-Host "PDF successfully created at $pdfPath"
