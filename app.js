const express = require('express')
const bodyParser = require('body-parser')
const { PDFParse } = require('pdf-parse');
const OpenAI = require("openai");


const schema = {
  type: "object",
  additionalProperties: false,   // obavezno
  properties: {
    lines: {
      type: "array",
      additionalProperties: false, // obavezno za svaki element u array
      items: {
        type: "object",
        additionalProperties: false, // obavezno
        properties: {
          lineId: { type: "string" },
          order: { type: "number" },
          character: { type: "string" },
          text: { type: "string" }
        },
        required: ["lineId", "order", "character", "text"]
      }
    }
  },
  required: ["lines"]
};

const app = express()
const port = 3000
app.use(bodyParser.json())

app.get('/', (req, res) => {
  res.send('Hello World!')
})

function splitIntoChunks(text, chunkSize = 10000) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + chunkSize));
    index += chunkSize;
  }
  return chunks;
}


app.post('/pdf/extract', async (req, res) => {
  const start = Date.now();

    try {
    const openai = new OpenAI({
      apiKey: ''
    });
    const { dataUrl, fileName } = req.body;

    if (!dataUrl) {
      return res.status(400).json({ error: "Missing PDF dataUrl" });
    }

    // Extract base64 portion if it's a data URL
    const base64Data = dataUrl.includes(",")
      ? dataUrl.split(",")[1]
      : dataUrl;

    // Convert to a Buffer (Node version of Uint8Array)
const pdfBuffer = Buffer.from(base64Data, "base64");
// const buffer = await readFile('reports/pdf/climate.pdf');
 const parser = new PDFParse({ data: pdfBuffer });
 const result = await parser.getText();
//const pdfData = await PDFParse({data:});

const pageChunks = result.pages.map((page) => optimizeScript(page.text));

const extractedText = result.text.trim();


    if (!extractedText) {
      return res.status(400).json({ error: "No text found in PDF" });
    }

    // for now do not do parsing, let's just send text to openAI
    // Split into lines

// This one is for now the best, response time around 10s other are 80-100 seconds

const promises = pageChunks.map((chunk) => openai.responses.create({
  model: "gpt-4o-mini",
    text: {
      format: {
        type: "json_schema",
        name: "dialogue_schema",
        schema: schema,
        strict: true
      }
    },
      input: `
You are a script extraction and dialogue parsing tool.

1. Output a JSON array containing ONLY the dialogue lines.
   Exclude stage directions, descriptions, and actions.
2.You must preserve real context and character names and script as it is in text

Each dialogue object must have:
- lineId: "L1", "L2", ...
- order: sequential number starting from 1
- character: uppercase character name
- text: dialogue only

Example:
[{"lineId":"L1","order":1,"character":"ASH","text":"Hello."}]

2. You output ONLY raw JSON. Never use code fences.

Here is the text: ${chunk}
          `.trim()
})); 




  const results = await Promise.all(promises);
  let mergedLines = [];

  results.forEach((response) => {
    const partial = response.output[0].content[0].text || '';
    try {
      // Parse the JSON string returned by OpenAI
      const parsed = JSON.parse(partial.trim());
      console.log('parsed:', parsed)
      if (Array.isArray(parsed.lines || [])) {
        mergedLines = mergedLines.concat(parsed.lines || []);
      }
    } catch (err) {
      console.error('Failed to parse JSON chunk:', err);
    }
  });

  // Rebuild final lines with proper lineId and order
  const finalLines = mergedLines.map((line, index) => ({
    lineId: `L${index + 1}`,
    order: index + 1,
    character: (line.character || '').trim().toUpperCase(),
    text: (line.text || '').trim(),
  }));

/*   console.log('response:', response)
  const exctractedLines = response.choices[0]?.message?.content || '';
  console.log('exctractedLines:', exctractedLines)
  const lines = JSON.parse(exctractedLines.trim());

 */

  console.log('process time in seconds:', (Date.now() - start) / 1000)

    return res.status(200).json({
      extractedText: extractedText.trim(),
      lines: finalLines
    });
  } catch (err) {
    console.error("Error parsing dialogue:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})




function optimizeScript(script) {
  // 1. Remove leading/trailing numbering like "3."
  script = script.replace(/^\s*\d+\.\s*/, '').replace(/\d+\.\s*$/, '');

  // 2. Normalize line breaks: keep only speaker changes and stage directions
  // Assume speaker lines are all-caps followed by optional colon/newline
  const lines = script.split('\n');
  const optimizedLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    if (!line) continue; // skip empty lines

    // Merge broken words like "cuff-\nlinks" => "cuff-links"
    if (line.endsWith('-') && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[i + 1].trim();
      i++; // skip next line
    }

    // Add colon after speaker name if missing
    if (/^[A-Z][A-Z\s]*$/.test(line)) {
      line = line.replace(/^([A-Z][A-Z\s]*)$/, '$1:');
    }

    optimizedLines.push(line);
  }

  // 3. Join lines with single space where appropriate
  return optimizedLines.join('\n');
}