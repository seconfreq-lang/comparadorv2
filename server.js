const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const XLSX = require('xlsx');
const stringSimilarity = require('string-similarity');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuração do multer para upload de arquivos
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Funções utilitárias para cálculos
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

// Normalizar números (vírgula para ponto)
const normalizeNumber = (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        return parseFloat(value.replace(',', '.')) || 0;
    }
    return 0;
};

// Parse de tamanho/unidade do nome do produto
const parseTamanhoUnidade = (xProd) => {
    if (!xProd) return { valor: null, unidadePadronizada: null, litrosOuKgPorUnidade: null };
    
    // Regex para extrair tamanho: número seguido de unidade
    const tamanhoMatch = xProd.match(/(\d+(?:[.,]\d+)?)\s*(G|KG|ML|L|LITRO|LITROS)\b/i);
    
    if (tamanhoMatch) {
        const valor = parseFloat(tamanhoMatch[1].replace(',', '.'));
        const unidade = tamanhoMatch[2].toUpperCase();
        
        let unidadePadronizada;
        let litrosOuKgPorUnidade;
        
        switch (unidade) {
            case 'G':
                unidadePadronizada = 'KG';
                litrosOuKgPorUnidade = valor / 1000;
                break;
            case 'KG':
                unidadePadronizada = 'KG';
                litrosOuKgPorUnidade = valor;
                break;
            case 'ML':
                unidadePadronizada = 'L';
                litrosOuKgPorUnidade = valor / 1000;
                break;
            case 'L':
            case 'LITRO':
            case 'LITROS':
                unidadePadronizada = 'L';
                litrosOuKgPorUnidade = valor;
                break;
            default:
                unidadePadronizada = null;
                litrosOuKgPorUnidade = null;
        }
        
        return { valor, unidadePadronizada, litrosOuKgPorUnidade };
    }
    
    return { valor: null, unidadePadronizada: null, litrosOuKgPorUnidade: null };
};

// Detectar pack/caixa no nome
const detectPack = (xProd) => {
    if (!xProd) return null;
    
    const packMatch = xProd.match(/(\d+)\s*(U|UN|UNID|PACK)\b/i);
    return packMatch ? parseInt(packMatch[1]) : null;
};

// Calcular unidades internas
const unidadesInternasDe = (item) => {
    const { uTrib, qTrib, xProd } = item;
    
    // Se uTrib é unidade direta (latas, garrafas, peças)
    if (['LAT', 'GR', 'PEC', 'UN', 'UN1', 'PC1'].includes(uTrib)) {
        return {
            unidades: qTrib,
            tipo: 'unidade_direta',
            observacao: `${qTrib} ${uTrib}`
        };
    }
    
    // Se uTrib é massa/volume, deduzir pela gramagem/volume do produto
    if (['KG', 'G', 'L', 'ML'].includes(uTrib)) {
        const tamanhoInfo = parseTamanhoUnidade(xProd);
        const pack = detectPack(xProd);
        
        if (tamanhoInfo.litrosOuKgPorUnidade) {
            // Converter qTrib para unidade padronizada se necessário
            let qTribPadronizada = qTrib;
            if (uTrib === 'G' && tamanhoInfo.unidadePadronizada === 'KG') {
                qTribPadronizada = qTrib / 1000;
            } else if (uTrib === 'ML' && tamanhoInfo.unidadePadronizada === 'L') {
                qTribPadronizada = qTrib / 1000;
            }
            
            const unidadesCalculadas = qTribPadronizada / tamanhoInfo.litrosOuKgPorUnidade;
            
            // Se detectou pack, verificar se o cálculo bate
            if (pack) {
                const unidadesArredondadas = Math.round(unidadesCalculadas);
                if (Math.abs(unidadesArredondadas - unidadesCalculadas) < 0.1) {
                    return {
                        unidades: unidadesArredondadas,
                        tipo: 'calculado_com_pack',
                        observacao: `${unidadesArredondadas} unidades (${tamanhoInfo.valor}${uTrib === 'G' || uTrib === 'KG' ? 'G' : 'ML'} cada, pack ${pack})`
                    };
                }
            }
            
            return {
                unidades: unidadesCalculadas,
                tipo: 'calculado',
                observacao: `${unidadesCalculadas.toFixed(2)} unidades (${tamanhoInfo.valor}${uTrib === 'G' || uTrib === 'KG' ? 'G' : 'ML'} cada)`
            };
        } else {
            // Não foi possível deduzir, mostrar R$/KG ou R$/L
            return {
                unidades: qTrib,
                tipo: 'unidade_nao_identificada',
                observacao: `R$/${uTrib} - unidade não identificada`
            };
        }
    }
    
    // Fallback: usar qTrib
    return {
        unidades: qTrib || 1,
        tipo: 'fallback',
        observacao: `${qTrib} ${uTrib} (fallback)`
    };
};

// Verificar se ICMS-ST deve ser cobrado no item
const isSTCobradoNoItem = (icmsData) => {
    if (!icmsData) return false;
    
    // Procurar por vICMSST em diferentes estruturas possíveis
    const vICMSST = icmsData.vICMSST || 
                   (icmsData.ICMS10 && icmsData.ICMS10.vICMSST) ||
                   (icmsData.ICMS30 && icmsData.ICMS30.vICMSST) ||
                   0;
    
    // Verificar CST para garantir que não é CST=60 (ST retido anteriormente)
    const cst = icmsData.CST || 
               (icmsData.ICMS10 && icmsData.ICMS10.CST) ||
               (icmsData.ICMS30 && icmsData.ICMS30.CST) ||
               (icmsData.ICMS60 && icmsData.ICMS60.CST) ||
               '';
    
    return vICMSST > 0 && cst !== '60';
};

// Calcular desconto rateado
const descontoRateado = (itens, vDescTotal) => {
    if (!vDescTotal || vDescTotal <= 0) return itens.map(() => 0);
    
    const somaVProd = itens.reduce((sum, item) => sum + (item.vProd || 0), 0);
    
    if (somaVProd <= 0) return itens.map(() => 0);
    
    return itens.map(item => {
        const vProd = item.vProd || 0;
        return (vProd * vDescTotal) / somaVProd;
    });
};

// Calcular preço por litro ou kg
const calcularPorLitroOuKg = (unitarioReal, xProd) => {
    const tamanhoInfo = parseTamanhoUnidade(xProd);
    
    if (tamanhoInfo.litrosOuKgPorUnidade && tamanhoInfo.unidadePadronizada) {
        const precoPortLitroOuKg = unitarioReal / tamanhoInfo.litrosOuKgPorUnidade;
        return {
            tipo: tamanhoInfo.unidadePadronizada,
            unitario: precoPortLitroOuKg
        };
    }
    
    return { tipo: null, unitario: null };
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
    let vDescTotal = 0;

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

    // Buscar desconto total da NF
    const possibleTotalPaths = [
        xmlData.nfeProc?.NFe?.infNFe?.total?.ICMSTot,
        xmlData.NFe?.infNFe?.total?.ICMSTot,
        xmlData.infNFe?.total?.ICMSTot
    ];

    for (const totalPath of possibleTotalPaths) {
        if (totalPath && totalPath.vDesc) {
            vDescTotal = normalizeNumber(totalPath.vDesc);
            break;
        }
    }

    // Primeira passada: coletar dados básicos
    const itemsBasicos = [];
    for (const det of detalhes) {
        const prod = det.prod;
        const imposto = det.imposto;
        if (!prod) continue;

        const codigo = String(prod.cProd || '');
        const descricao = String(prod.xProd || '');
        const uCom = String(prod.uCom || '');
        const qCom = normalizeNumber(prod.qCom);
        const vUnCom = normalizeNumber(prod.vUnCom);
        const vProd = normalizeNumber(prod.vProd);
        const uTrib = String(prod.uTrib || '');
        const qTrib = normalizeNumber(prod.qTrib);
        const vUnTrib = normalizeNumber(prod.vUnTrib);
        const vDesc = normalizeNumber(prod.vDesc);
        const vOutro = normalizeNumber(prod.vOutro);

        // Normalizar EANs
        const ean = normEAN(prod.cEAN);
        const eanTrib = normEAN(prod.cEANTrib);

        // Buscar impostos
        let vIPI = 0;
        let vICMSST = 0;
        
        if (imposto) {
            // IPI
            if (imposto.IPI && imposto.IPI.IPITrib && imposto.IPI.IPITrib.vIPI) {
                vIPI = normalizeNumber(imposto.IPI.IPITrib.vIPI);
            }
            
            // ICMS-ST
            if (imposto.ICMS) {
                const icmsData = imposto.ICMS;
                if (isSTCobradoNoItem(icmsData)) {
                    vICMSST = normalizeNumber(
                        icmsData.vICMSST || 
                        (icmsData.ICMS10 && icmsData.ICMS10.vICMSST) ||
                        (icmsData.ICMS30 && icmsData.ICMS30.vICMSST) ||
                        0
                    );
                }
            }
        }

        itemsBasicos.push({
            codigo,
            descricao,
            xProd: descricao, // Para compatibilidade com funções utilitárias
            uCom,
            qCom,
            uTrib,
            qTrib,
            vProd,
            vDesc,
            vOutro,
            vIPI,
            vICMSST,
            ean,
            eanTrib
        });
    }

    // Calcular desconto rateado se necessário
    const descontosPorItem = descontoRateado(itemsBasicos, vDescTotal);

    // Segunda passada: enriquecer com cálculos completos
    for (let i = 0; i < itemsBasicos.length; i++) {
        const item = itemsBasicos[i];
        
        // Determinar desconto aplicado
        const descontoAplicado = item.vDesc > 0 ? item.vDesc : descontosPorItem[i];
        
        // Calcular total do item (preço pago)
        const totalItem = (item.vProd - descontoAplicado) + item.vIPI + item.vICMSST + item.vOutro;
        
        // Calcular unidades internas
        const unidadesInfo = unidadesInternasDe(item);
        
        // Calcular unitário real
        const unitarioReal = unidadesInfo.unidades > 0 ? totalItem / unidadesInfo.unidades : 0;
        
        // Calcular preço por litro/kg quando disponível
        const porLitroOuKg = calcularPorLitroOuKg(unitarioReal, item.xProd);
        
        // Preço unitário antigo (para compatibilidade)
        const vProdLiquido = item.vProd - descontoAplicado;
        const precoXML_unit = item.qCom > 0 ? vProdLiquido / item.qCom : 0;

        items.push({
            codigo: item.codigo,
            descricao: item.descricao,
            uCom: item.uCom,
            qCom: item.qCom,
            uTrib: item.uTrib,
            qTrib: item.qTrib,
            vProd: item.vProd,
            vDesc: item.vDesc,
            vProdLiquido,
            precoXML_unit: Math.round(precoXML_unit * 10000) / 10000,
            ean: item.ean,
            eanTrib: item.eanTrib,
            
            // Novos campos de cálculo
            precoBruto: item.vProd,
            descontoAplicado: Math.round(descontoAplicado * 100) / 100,
            ipi: item.vIPI,
            icmsst: item.vICMSST,
            outros: item.vOutro,
            totalItem: Math.round(totalItem * 100) / 100,
            unidadesInternas: Math.round(unidadesInfo.unidades * 100) / 100,
            unitarioReal: Math.round(unitarioReal * 10000) / 10000,
            porLitroOuKg,
            notasCalculo: {
                uCom: item.uCom,
                uTrib: item.uTrib,
                qCom: item.qCom,
                qTrib: item.qTrib,
                tipoUnidade: unidadesInfo.tipo,
                observacaoUnidade: unidadesInfo.observacao,
                packDetectado: detectPack(item.xProd),
                tamanhoDetectado: parseTamanhoUnidade(item.xProd)
            }
        });
    }

    // Buscar vNF total para conferência
    let vNFTotal = 0;
    for (const totalPath of possibleTotalPaths) {
        if (totalPath && totalPath.vNF) {
            vNFTotal = normalizeNumber(totalPath.vNF);
            break;
        }
    }
    
    return { items, vDescTotal, vNFTotal };
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

// Endpoint principal
app.post('/api/comparar', upload.fields([
    { name: 'xml', maxCount: 1 },
    { name: 'xlsx', maxCount: 1 }
]), async (req, res) => {
    try {
    console.log("=== ENDPOINT /api/comparar CHAMADO ===");
        if (!req.files.xml || !req.files.xlsx) {
            return res.status(400).json({ 
                error: 'Arquivos XML e Excel são obrigatórios' 
            });
        }

        const xmlBuffer = req.files.xml[0].buffer;
        const excelBuffer = req.files.xlsx[0].buffer;

        // Parse dos arquivos
        // Obter margem configurada pelo usuário (padrão 50% = 1.5x)
        const marginPercent = parseFloat(req.body.marginPercent) || 50;
        const multiplier = 1 + (marginPercent / 100);
        
        const xmlResult = parseXMLData(xmlBuffer);
        const xmlItems = xmlResult.items;
        const vDescTotal = xmlResult.vDescTotal;
        const vNFTotal = xmlResult.vNFTotal;
        const { mapByEan, mapByCode, rows } = parseExcelData(excelBuffer);

        console.log(`✓ Parsed ${xmlItems.length} items from XML`);
        console.log(`✓ Parsed ${Object.keys(mapByEan).length} EAN mappings from Excel`);

        const results = [];

        for (const item of xmlItems) {
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

            // Calcular preço mínimo baseado no unitário real com margem configurável
            const precoMinimo = Math.round(item.unitarioReal * multiplier * 10000) / 10000;
            let status;

            if (item.unitarioReal <= 0) {
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
                quantidadeXml: item.qCom,
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
                
                // Novos campos
                precoBruto: item.precoBruto,
                descontoAplicado: item.descontoAplicado,
                ipi: item.ipi,
                icmsst: item.icmsst,
                outros: item.outros,
                totalItem: item.totalItem,
                unidadesInternas: item.unidadesInternas,
                unitarioReal: item.unitarioReal,
                porLitroOuKg: item.porLitroOuKg,
                notasCalculo: item.notasCalculo
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

        // Calcular totais para conferência
        const somaItens = results.reduce((sum, item) => sum + (item.totalItem || 0), 0);
        
        const diferenca = somaItens - vNFTotal;
        
        res.json({
            items: results,
            conferencia: {
                somaItens: Math.round(somaItens * 100) / 100,
                vDescTotal,
                vNFTotal: Math.round(vNFTotal * 100) / 100,
                diferenca: Math.round(diferenca * 100) / 100
            },
            config: {
                marginPercent: marginPercent,
                multiplier: multiplier
            }
        });

    } catch (error) {
        console.error('Erro no endpoint:', error);
        res.status(500).json({ 
            error: error.message || 'Erro interno do servidor' 
        });
    }
});

// Servir arquivos estáticos
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

module.exports = app;