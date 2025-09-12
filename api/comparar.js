const multer = require('multer');
const { XMLParser } = require('fast-xml-parser');
const XLSX = require('xlsx');
const stringSimilarity = require('string-similarity');

// Configuração do multer para upload de arquivos
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Funções utilitárias
const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');

const normEAN = (s) => {
    console.log("DEBUG normEAN input:", s, "type:", typeof s);
    if (!s || s === "SEM GTIN") return null;
    const d = String(s).replace(/\D/g, "");
    console.log("DEBUG onlyDigits result:", d, "length:", d.length);
    if (!d || d.length === 0) return null;
    // Aceitar apenas comprimentos padrão de EAN/GTIN
    const result = [8, 12, 13, 14].includes(d.length) ? d : null;
    console.log("DEBUG normEAN result:", result);
    return result;
};

// Função para detectar multiplicador em descrição
const detectMultiplier = (description) => {
    if (!description) return 1;
    
    const patterns = [
        /CX(\d+)/i,
        /C\/(\d+)/i,
        /(\d+)\s*UN[DI]?\b/i,
        /(\d+)\s*x/i,
        /FARDO\s*(\d+)/i,
        /KIT\s*(\d+)/i
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match) {
            return parseInt(match[1]) || 1;
        }
    }
    return 1;
};

// Extrair peso unitário do xProd (ex: "PRESUNTO FATIADO RESFRIADO 180G VC SADIA" -> 180)
const extrairPesoUnitario = (xProd) => {
    if (!xProd) return null;
    
    // Buscar padrões como 180G, 500G, 1.5KG, etc.
    const pesoMatch = xProd.match(/(\d+(?:[.,]\d+)?)\s*(G|KG)\b/i);
    
    if (pesoMatch) {
        const valor = parseFloat(pesoMatch[1].replace(',', '.'));
        const unidade = pesoMatch[2].toUpperCase();
        
        // Converter tudo para gramas
        if (unidade === 'KG') {
            return valor * 1000;
        } else {
            return valor; // já está em gramas
        }
    }
    
    return null;
};

// Função para normalizar nomes para fuzzy matching
const normalizeName = (name) => {
    if (!name) return '';
    
    // Converter para maiúscula e remover acentos
    let normalized = name.toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    
    // Remover tokens de ruído
    const noiseTokens = ['LT', 'LATA', 'PET', 'CP', 'FI', 'FL', 'CX', 'PACK', 'FARDO', 'KIT'];
    for (const token of noiseTokens) {
        normalized = normalized.replace(new RegExp(`\\b${token}\\b`, 'g'), ' ');
    }
    
    // Remover padrões específicos
    normalized = normalized
        .replace(/C\/\d+/g, ' ')
        .replace(/\d+UN/g, ' ')
        .replace(/\d+X/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    return normalized;
};

// Função para extrair tokens de capacidade
const extractCapacityTokens = (name) => {
    const capacityPattern = /(\d+(?:\.\d+)?)(ML|L|G|KG|MG)\b/gi;
    const tokens = [];
    let match;
    while ((match = capacityPattern.exec(name)) !== null) {
        tokens.push(match[0].toUpperCase());
    }
    return tokens;
};

// Função para verificar overlap de capacidades
const hasCapacityOverlap = (name1, name2) => {
    const tokens1 = extractCapacityTokens(name1);
    const tokens2 = extractCapacityTokens(name2);
    
    if (tokens1.length === 0 || tokens2.length === 0) return true;
    
    return tokens1.some(t1 => tokens2.some(t2 => t1 === t2));
};

// Parse do XML NFe
const parseXMLData = (xmlBuffer) => {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: false,  // Não converter valores para números automaticamente
        trimValues: false      // Não remover espaços/zeros
    });

    const xmlData = parser.parse(xmlBuffer.toString('utf8'));
    const items = [];

    // Encontrar detalhes dos produtos
    let detalhes = [];
    
    // Diferentes estruturas possíveis da NFe
    const possiblePaths = [
        xmlData.nfeProc?.NFe?.infNFe?.det,
        xmlData.NFe?.infNFe?.det,
        xmlData.infNFe?.det
    ];

    for (const path of possiblePaths) {
        if (path) {
            detalhes = Array.isArray(path) ? path : [path];
            break;
        }
    }

    if (detalhes.length === 0) {
        throw new Error('Nenhum produto encontrado no XML da NFe');
    }

    for (const det of detalhes) {
        const prod = det.prod;
        if (!prod) continue;

        const codigo = String(prod.cProd || '');
        const descricao = String(prod.xProd || '');
        const uCom = String(prod.uCom || '');
        const qCom = parseFloat(prod.qCom || 0);
        const vUnCom = parseFloat(prod.vUnCom || 0);
        const vProd = parseFloat(prod.vProd || 0);
        const uTrib = String(prod.uTrib || '');
        const qTrib = parseFloat(prod.qTrib || 0);
        const vUnTrib = parseFloat(prod.vUnTrib || 0);
        const vDesc = parseFloat(prod.vDesc || 0);

        // Normalizar EANs
        const ean = normEAN(prod.cEAN);
        const eanTrib = normEAN(prod.cEANTrib);

        // Aplicar regra especial para uTrib = "KG"
        let qtribFinal = qTrib;
        let observacaoKG = '';
        
        if (uTrib && uTrib.toUpperCase() === 'KG') {
            const pesoUnitario = extrairPesoUnitario(descricao);
            if (pesoUnitario && pesoUnitario > 0) {
                // Converter qTrib de KG para gramas e dividir pelo peso unitário
                const qTribGramas = qTrib * 1000;
                qtribFinal = qTribGramas / pesoUnitario;
                observacaoKG = `Regra KG aplicada: ${qTrib}KG ÷ ${pesoUnitario}G = ${qtribFinal.toFixed(2)} unidades`;
            }
        }
        
        // Calcular preço unitário: (Valor Produto - Desconto) / Quantidade
        const vProdLiquido = vProd - vDesc; // Valor do produto após desconto
        let precoXML_unit = 0;
        
        if (qtribFinal > 0) {
            precoXML_unit = vProdLiquido / qtribFinal;
        } else {
            precoXML_unit = 0; // Se não há quantidade, preço unitário é 0
        }

        items.push({
            codigo,
            descricao,
            uCom,
            qCom,
            uTrib,
            qTrib: qtribFinal,
            vProd,
            vDesc,
            vProdLiquido,
            precoXML_unit: Math.round(precoXML_unit * 10000) / 10000,
            ean,
            eanTrib
        });
    }

    return items;
};

// Parse do Excel
const parseExcelData = (excelBuffer) => {
    const workbook = XLSX.read(excelBuffer, { type: 'buffer', raw: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

    if (data.length < 2) {
        throw new Error('Planilha deve ter pelo menos cabeçalho e uma linha de dados');
    }

    const headers = data[0];
    const mapByEan = {};
    const mapByCode = {};
    const rows = [];

    // Mapear colunas
    const colIndexes = {
        preco: -1,
        ean: -1,
        descricao: -1,
        codigo: -1
    };

    headers.forEach((header, index) => {
        const headerStr = String(header || '').trim();
        if (headerStr === 'Preço') colIndexes.preco = index;
        else if (headerStr === 'Código de barras') colIndexes.ean = index;
        else if (headerStr === 'Descrição Produto') colIndexes.descricao = index;
        else if (headerStr === 'Código Produto') colIndexes.codigo = index;
    });

    // Verificar se colunas obrigatórias foram encontradas
    if (colIndexes.preco === -1) throw new Error('Coluna "Preço" não encontrada');
    if (colIndexes.ean === -1) throw new Error('Coluna "Código de barras" não encontrada');

    // Processar linhas de dados
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        const preco = parseFloat(row[colIndexes.preco] || 0);
        const eanRaw = row[colIndexes.ean];
        const eanExcel = String(eanRaw ?? '').replace(/\D/g, '');
        const nomeExcel = String(row[colIndexes.descricao] || '').trim();
        const codigoExcel = String(row[colIndexes.codigo] || '').trim();

        if (preco > 0) {
            if (eanExcel) {
                mapByEan[eanExcel] = preco;
            }
            if (codigoExcel) {
                mapByCode[codigoExcel] = preco;
            }
        }

        rows.push({
            preco,
            eanExcel,
            nomeExcel,
            codigoExcel
        });
    }

    return { mapByEan, mapByCode, rows };
};

// Middleware para upload
const uploadMiddleware = upload.fields([
    { name: 'xml', maxCount: 10 }, // Permitir até 10 XMLs
    { name: 'xlsx', maxCount: 1 }
]);

// Função principal da API
const handler = async (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    return new Promise((resolve, reject) => {
        uploadMiddleware(req, res, async (err) => {
            if (err) {
                console.error('Upload error:', err);
                return res.status(400).json({ error: 'Upload failed' });
            }

            try {
                console.log("=== ENDPOINT /api/comparar CHAMADO ===");
                
                if (!req.files.xml || !req.files.xlsx) {
                    return res.status(400).json({ 
                        error: 'Arquivos XML e Excel são obrigatórios' 
                    });
                }

                const xmlFiles = req.files.xml; // Array de arquivos XML
                const excelBuffer = req.files.xlsx[0].buffer;

                // Parse dos arquivos - processar múltiplos XMLs
                let allXmlItems = [];
                
                console.log(`✓ Processando ${xmlFiles.length} arquivo(s) XML`);
                
                for (let i = 0; i < xmlFiles.length; i++) {
                    const xmlBuffer = xmlFiles[i].buffer;
                    const xmlItems = parseXMLData(xmlBuffer);
                    
                    // Adicionar identificador do arquivo de origem
                    const itemsWithSource = xmlItems.map(item => ({
                        ...item,
                        arquivoOrigem: xmlFiles[i].originalname || `XML_${i + 1}`
                    }));
                    
                    allXmlItems = allXmlItems.concat(itemsWithSource);
                    console.log(`  ✓ XML ${i + 1}: ${xmlItems.length} itens`);
                }
                
                const { mapByEan, mapByCode, rows } = parseExcelData(excelBuffer);

                console.log(`✓ Total de ${allXmlItems.length} itens de todos os XMLs`);
                console.log(`✓ Parsed ${Object.keys(mapByEan).length} EAN mappings from Excel`);

                const results = [];

                for (const item of allXmlItems) {
                    let precoTabela = 0;
                    let matchType = 'NULL';
                    let eanExcel = '';
                    let observacoes = '';

                    // 1º: Tentar match por cEAN
                    if (item.ean && mapByEan[item.ean]) {
                        precoTabela = mapByEan[item.ean];
                        matchType = 'EAN-Com';
                        eanExcel = item.ean;
                    }
                    // 2º: Tentar match por cEANTrib
                    else if (item.eanTrib && mapByEan[item.eanTrib]) {
                        precoTabela = mapByEan[item.eanTrib];
                        matchType = 'EAN-Trib';
                        eanExcel = item.eanTrib;
                    }
                    // 3º: Tentar match por código
                    else if (item.codigo && mapByCode[item.codigo]) {
                        precoTabela = mapByCode[item.codigo];
                        matchType = 'CODIGO';
                    }
                    // 4º: Fuzzy matching por nome
                    else {
                        let bestMatch = null;
                        let bestScore = 0;

                        const normalizedItemName = normalizeName(item.descricao);
                        
                        for (const row of rows) {
                            if (!row.nomeExcel || row.preco <= 0) continue;
                            
                            const normalizedRowName = normalizeName(row.nomeExcel);
                            
                            // Verificar overlap de capacidade primeiro
                            if (!hasCapacityOverlap(item.descricao, row.nomeExcel)) {
                                continue;
                            }
                            
                            const score = stringSimilarity.compareTwoStrings(
                                normalizedItemName, 
                                normalizedRowName
                            );
                            
                            if (score > bestScore && score >= 0.80) {
                                bestScore = score;
                                bestMatch = row;
                            }
                        }

                        if (bestMatch) {
                            precoTabela = bestMatch.preco;
                            matchType = 'FUZZY';
                            eanExcel = bestMatch.eanExcel;
                        } else {
                            // Definir observações específicas
                            if (!item.ean && !item.eanTrib) {
                                observacoes = 'EAN XML vazio/SEM GTIN';
                            } else if (item.ean && item.eanTrib) {
                                observacoes = 'cEAN sem match; cEANTrib sem match';
                            } else if (item.ean) {
                                observacoes = 'cEAN sem match';
                            } else {
                                observacoes = 'cEANTrib sem match';
                            }
                        }
                    }

                    // Calcular preço mínimo e status
                    const precoMinimo = Math.round(item.precoXML_unit * 1.5 * 10000) / 10000;
                    let status;

                    if (item.precoXML_unit <= 0) {
                        status = 'ERRO_PARSING';
                    } else if (precoTabela <= 0) {
                        status = 'SEM_PRECO';
                    } else if (precoTabela >= precoMinimo) {
                        status = 'OK';
                    } else {
                        status = 'ABAIXO_MINIMO';
                    }

                    results.push({
                        codigo: item.codigo,
                        descricao: item.descricao,
                        quantidadeXml: item.qTrib,
                        unidade: item.uCom || item.uTrib,
                        ean: item.ean || '',
                        eanTrib: item.eanTrib || '',
                        eanExcel,
                        vProd: item.vProd || 0,
                        vDesc: item.vDesc || 0,
                        vProdLiquido: item.vProdLiquido || 0,
                        precoXML_unit: item.precoXML_unit,
                        precoTabela,
                        precoMinimo,
                        status,
                        matchType,
                        observacoes,
                        arquivoOrigem: item.arquivoOrigem
                    });
                }

                // Log de diagnóstico
                const diagnostico = {
                    itens: results.length,
                    comEAN: results.filter(r => r.ean).length,
                    comEANTrib: results.filter(r => r.eanTrib).length
                };

                console.log('=== DIAGNÓSTICO ===');
                console.log(diagnostico);
                
                const semPreco = results.filter(r => r.status === 'SEM_PRECO').slice(0, 10);
                console.log('=== PRIMEIROS 10 SEM_PRECO ===');
                semPreco.forEach(item => {
                    console.log({
                        descricao: item.descricao,
                        ean: item.ean,
                        eanTrib: item.eanTrib
                    });
                });

                res.json(results);
                resolve();

            } catch (error) {
                console.error('Erro no endpoint:', error);
                res.status(500).json({ 
                    error: error.message || 'Erro interno do servidor' 
                });
                resolve();
            }
        });
    });
};

module.exports = handler;