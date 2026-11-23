# PDF Flipbook για Joomla 6 + YOOtheme Pro

Προβάλλει PDF σαν έντυπο που ξεφυλλίζεται, όπως το Adobe InDesign Publish Online:
διπλές σελίδες με εφέ γυρίσματος, βέλη, μικρογραφίες σελίδων, zoom, πλήρη οθόνη και λήψη.

Είναι **ένα system plugin** (`plg_system_pdfflipbook`). Περιέχει:

- το element **PDF Flipbook** για τον builder του YOOtheme Pro (ομάδα *Media*),
- το shortcode `{pdfflipbook src="images/catalogue.pdf"}` για άρθρα, modules και Text elements,
- τον viewer (pdf.js 5.7, Apache-2.0), που φορτώνεται **μόνο** στις σελίδες που έχουν flipbook.

## Ασφαλές στις ενημερώσεις

Το element **δεν** μπαίνει στον φάκελο του YOOtheme ή σε child theme. Ζει μέσα στο plugin
(`plugins/system/pdfflipbook/yootheme/elements/pdf_flipbook`) και δηλώνεται στο YOOtheme
μέσω του επίσημου μηχανισμού modules (`Builder::addTypePath`). Έτσι οι ενημερώσεις του
YOOtheme Pro ή του Joomla δεν το αγγίζουν. Οι layouts που χρησιμοποιούν το element μένουν
ως έχουν, ακόμη και όταν αναβαθμίζεις το ίδιο το plugin (η εγκατάσταση γίνεται με `method="upgrade"`).

## Εγκατάσταση

1. Φτιάξε το πακέτο με `./build.sh` (ή χρησιμοποίησε το έτοιμο zip).
2. Joomla → *System → Install → Extensions* → ανέβασε το `plg_system_pdfflipbook-x.y.z.zip`.
3. *System → Plugins* → ενεργοποίησε το **System - PDF Flipbook**.
4. Άνοιξε ξανά τον YOOtheme Builder. Το element **PDF Flipbook** εμφανίζεται στην ομάδα *Media*.

Απαιτήσεις: Joomla 6.x (δοκιμασμένο για 6.2), PHP 8.3+ και, για το element, έκδοση του YOOtheme Pro συμβατή με Joomla 6.
Το shortcode δουλεύει και χωρίς YOOtheme.

## Χρήση

### YOOtheme element

*Content*: επίλεξε το PDF από τα Media (ή γράψε URL) και, αν θέλεις, έναν τίτλο.
Και τα δύο πεδία δέχονται Dynamic Content, π.χ. ένα custom field τύπου media σε άρθρο.

*Settings*: ύψος («Fit screen» ή δικό σου), διάταξη (αυτόματη, διπλή ή μονή σελίδα), εξώφυλλο, σελίδα έναρξης,
κουμπιά μικρογραφιών και λήψης, χρώματα.

### Shortcode

```
{pdfflipbook src="images/catalogue.pdf"}
{pdfflipbook src="images/catalogue.pdf" title="Κατάλογος 2027" height="700px" mode="double" cover="1" start="1" download="0" thumbs="1" background="#1e1e1e" accent="#ffffff"}
```

| Παράμετρος | Τιμές | Προεπιλογή |
|---|---|---|
| `src` | διαδρομή ή URL του PDF (υποχρεωτικό) | – |
| `title` | κείμενο στην πάνω μπάρα | κενό |
| `height` | `screen`, `700`, `700px`, `80vh`, … | από το plugin (`screen`) |
| `mode` | `auto`, `double`, `single` | από το plugin (`auto`) |
| `cover` | `1` / `0`: η 1η σελίδα μόνη της | από το plugin (`1`) |
| `start` | αριθμός σελίδας | `1` |
| `download` | `1` / `0` | από το plugin (`1`) |
| `print` | `1` / `0` | από το plugin (`1`) |
| `thumbs` | `1` / `0` | `1` |
| `background`, `accent` | χρώμα (`#hex`, `rgb()`) | από το plugin |

### Προσαρμογή στο ύψος της οθόνης

Η προεπιλογή είναι `screen` («Fit screen» στο element). Ο viewer γεμίζει όλο το ύψος της
οθόνης κάτω από το sticky header του site, και η σελίδα του PDF χωράει ολόκληρη χωρίς
scroll. Το ύψος του header (YOOtheme, Cassiopeia ή οποιοδήποτε sticky/fixed `<header>`)
μετριέται αυτόματα και ξαναϋπολογίζεται όταν αλλάζει το μέγεθος του παραθύρου ή ο
προσανατολισμός του κινητού.

### Ρυθμίσεις plugin

Προεπιλεγμένο ύψος, διάταξη, εξώφυλλο, κουμπί λήψης και χρώματα. Υπάρχει και η επιλογή
«Φόρτωση σε κάθε σελίδα», που χρειάζεται μόνο αν το flipbook μπαίνει στη σελίδα αργότερα
με JavaScript (π.χ. σε modal που φορτώνει με AJAX).

## Λειτουργίες του viewer

- Διπλές σελίδες με τρισδιάστατο γύρισμα σελίδας και σκιά στη ράχη. Το εξώφυλλο και το
  οπισθόφυλλο κεντράρονται, σαν κλειστό βιβλίο.
- Σε κινητά ή στενές στήλες περνά αυτόματα σε μονή σελίδα, με swipe για αλλαγή σελίδας.
- Βέλη στα πλάγια, κλικ πάνω στη σελίδα, πλήκτρα ← → Home End + −.
- Μπάρα: μικρογραφίες, πρώτη/προηγούμενη/επόμενη/τελευταία σελίδα, πεδίο «μετάβαση σε σελίδα»,
  zoom (έως 400%, με σύρσιμο για μετακίνηση και διπλό κλικ για zoom), πλήρης οθόνη, εκτύπωση, λήψη.
- **Εκτύπωση μόνο του PDF**: όλες οι σελίδες ζωγραφίζονται σε υψηλή ανάλυση (180 dpi) σε ένα
  κρυφό iframe και τυπώνεται μόνο αυτό, όχι η ιστοσελίδα. Το μέγεθος χαρτιού ακολουθεί το PDF.
  Στο iPhone/iPad ανοίγει το PDF στον viewer του Safari, από όπου γίνεται η εκτύπωση.
- Τα links μέσα στο PDF (web και εσωτερικά «πήγαινε στη σελίδα Χ») είναι ενεργά.
- Lazy loading: το PDF φορτώνει όταν ο επισκέπτης φτάσει κοντά στο flipbook, και με
  range requests κατεβαίνουν μόνο οι σελίδες που χρειάζονται. Αυτό βοηθά πολύ σε μεγάλους καταλόγους.
- Πολλά flipbooks στην ίδια σελίδα, ελληνικά και αγγλικά κείμενα (από τα language files).
- Στο iPhone, όπου δεν υπάρχει πραγματική πλήρης οθόνη για στοιχεία σελίδας, το flipbook
  καλύπτει όλο το παράθυρο.

## Σημειώσεις

- Το PDF πρέπει να βρίσκεται στο ίδιο site. Αν είναι σε άλλο domain, ο server εκείνος
  πρέπει να επιτρέπει CORS.
- Για γρήγορη πρώτη εμφάνιση σε μεγάλα PDF, αποθήκευσέ τα ως «Optimized for Fast Web View»
  (Acrobat ή InDesign export).
- Οι σελίδες ζωγραφίζονται σε canvas, οπότε το κείμενο δεν επιλέγεται. Για SEO, το element
  αφήνει link προς το PDF στο περιεχόμενο του άρθρου.

## Δομή

```
plg_system_pdfflipbook/
├─ pdfflipbook.xml                 manifest (Joomla 6, method="upgrade")
├─ services/provider.php           DI provider
├─ src/Extension/PdfFlipbook.php   shortcode, assets, εγγραφή YOOtheme element
├─ yootheme/bootstrap.php          YOOtheme module → Builder::addTypePath
├─ yootheme/elements/pdf_flipbook/ element.json + templates + icons
├─ language/en-GB, el-GR
└─ media/                          → /media/plg_system_pdfflipbook
   ├─ js/flipbook.js, css/flipbook.css
   └─ vendor/pdfjs/                pdf.js 5.7.284 (legacy build), cmaps, fonts, wasm
```
