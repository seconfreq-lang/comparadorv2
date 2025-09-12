class NFEComparator {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.statusFilter = 'ALL';
        this.matchFilter = 'ALL';
        this.searchQuery = '';
        this.conferencia = null;
        this.marginPercent = 50; // Padrão 50% = 1.5x

        this.initializeEventListeners();
        this.updateButtonStates();
        this.updateMarginDisplay();
        this.updateClearButtonStates();
    }

    initializeEventListeners() {
        // File uploads
        document.getElementById('xmlFile').addEventListener('change', (e) => {
            this.handleFileUpload(e, 'xml');
        });

        document.getElementById('xlsxFile').addEventListener('change', (e) => {
            this.handleFileUpload(e, 'xlsx');
        });

        // Compare button
        document.getElementById('compareBtn').addEventListener('click', () => {
            this.compareFiles();
        });

        // Export button
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportToCSV();
        });

        // Details button
        document.getElementById('detailsBtn').addEventListener('click', () => {
            this.showCalculationDetails();
        });

        // Status filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setStatusFilter(e.target.dataset.filter);
            });
        });

        // Match type filters
        document.querySelectorAll('.filter-btn-match').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setMatchFilter(e.target.dataset.filter);
            });
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.applyFilters();
        });
        
        // Margin percent
        document.getElementById('marginPercent').addEventListener('input', (e) => {
            this.marginPercent = parseFloat(e.target.value) || 50;
            this.updateMarginDisplay();
            // Recalcular se já temos dados
            if (this.data.length > 0) {
                this.recalculateWithNewMargin();
            }
        });

        // Clear buttons
        document.getElementById('clearXmlBtn').addEventListener('click', () => {
            this.clearFiles('xml');
        });

        document.getElementById('clearXlsxBtn').addEventListener('click', () => {
            this.clearFiles('xlsx');
        });
    }

    handleFileUpload(event, type) {
        console.log(`File upload event for ${type}:`, event.target.files);
        
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const fileNameElement = document.getElementById(`${type}FileName`);
        
        if (type === 'xml') {
            // Para XMLs, mostrar quantos arquivos foram selecionados
            if (fileNameElement) {
                if (files.length === 1) {
                    fileNameElement.textContent = files[0].name;
                } else {
                    fileNameElement.textContent = `${files.length} arquivos XML selecionados`;
                }
            }
        } else {
            // Para Excel, apenas um arquivo
            const file = files[0];
            if (fileNameElement) {
                fileNameElement.textContent = file.name;
            }
        }

        // Buscar o upload-area corretamente
        const uploadLabel = event.target.closest('.upload-label');
        const uploadArea = uploadLabel ? uploadLabel.querySelector('.upload-area') : null;
        
        if (uploadArea) {
            uploadArea.classList.add('has-file');
        } else {
            console.warn('Upload area not found for', type);
        }

        console.log(`Calling updateButtonStates after ${type} upload`);
        this.updateButtonStates();
        this.updateClearButtonStates();
    }

    updateButtonStates() {
        console.log("updateButtonStates called");
        const xmlFiles = document.getElementById('xmlFile').files;
        const xlsxFile = document.getElementById('xlsxFile').files[0];
        const compareBtn = document.getElementById('compareBtn');

        console.log("XML files:", xmlFiles, "XLSX file:", xlsxFile);
        console.log("Button will be disabled:", !xmlFiles.length || !xlsxFile);
        
        if (compareBtn) {
            compareBtn.disabled = !xmlFiles.length || !xlsxFile;
        }
        
        // Atualizar outros botões se necessário
        const detailsBtn = document.getElementById('detailsBtn');
        if (detailsBtn && !this.data.length) {
            detailsBtn.disabled = true;
        }
    }

    async compareFiles() {
        const xmlFiles = document.getElementById('xmlFile').files;
        const xlsxFile = document.getElementById('xlsxFile').files[0];

        if (!xmlFiles.length || !xlsxFile) {
            this.showError('Por favor, selecione pelo menos um arquivo XML e um arquivo Excel');
            return;
        }

        this.showLoading(true);
        this.hideError();

        try {
            const formData = new FormData();
            
            // Adicionar todos os arquivos XML
            for (let i = 0; i < xmlFiles.length; i++) {
                formData.append('xml', xmlFiles[i]);
            }
            
            formData.append('xlsx', xlsxFile);
            formData.append('marginPercent', this.marginPercent.toString());

            const response = await fetch('/api/comparar', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erro na comparação');
            }

            const result = await response.json();
            this.data = result.items || result; // Compatibilidade
            this.conferencia = result.conferencia;
            this.applyFilters();
            this.updateStats();
            this.updateConferencia();
            
            document.getElementById('exportBtn').disabled = false;
            document.getElementById('detailsBtn').disabled = false;

            // Log diagnóstico no console
            console.log('=== DADOS RECEBIDOS ===');
            console.log(`Total de itens: ${data.length}`);
            console.log(`Com EAN: ${data.filter(d => d.ean).length}`);
            console.log(`Com EAN Trib: ${data.filter(d => d.eanTrib).length}`);

        } catch (error) {
            this.showError(`Erro: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    setStatusFilter(filter) {
        this.statusFilter = filter;
        
        // Update active button
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        this.applyFilters();
    }

    setMatchFilter(filter) {
        this.matchFilter = filter;
        
        // Update active button
        document.querySelectorAll('.filter-btn-match').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        this.applyFilters();
    }

    applyFilters() {
        let filtered = [...this.data];

        // Filter by status
        if (this.statusFilter !== 'ALL') {
            filtered = filtered.filter(item => item.status === this.statusFilter);
        }

        // Filter by match type
        if (this.matchFilter !== 'ALL') {
            filtered = filtered.filter(item => item.matchType === this.matchFilter);
        }

        // Filter by search
        if (this.searchQuery) {
            filtered = filtered.filter(item => 
                item.codigo.toLowerCase().includes(this.searchQuery) ||
                item.descricao.toLowerCase().includes(this.searchQuery) ||
                item.ean.toLowerCase().includes(this.searchQuery) ||
                item.eanTrib.toLowerCase().includes(this.searchQuery)
            );
        }

        this.filteredData = filtered;
        this.renderTable();
    }

    renderTable() {
        const tbody = document.getElementById('resultsBody');
        tbody.innerHTML = '';

        if (this.filteredData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="21" class="text-center">Nenhum resultado encontrado</td></tr>';
            return;
        }

        this.filteredData.forEach(item => {
            const row = document.createElement('tr');
            
            const porLitroOuKgText = this.formatPorLitroOuKg(item.porLitroOuKg);
            const unidadesText = this.formatUnidades(item.unidadesInternas, item.notasCalculo?.observacaoUnidade);
            
            row.innerHTML = `
                <td class="font-mono">${item.codigo}</td>
                <td class="font-mono">${item.ean}</td>
                <td class="font-mono">${item.eanTrib}</td>
                <td class="font-mono">${item.eanExcel}</td>
                <td>${item.descricao}</td>
                <td class="text-right">${this.formatNumber(item.quantidadeXml)}</td>
                <td class="text-center">${item.unidade}</td>
                <td class="currency">${this.formatCurrency(item.precoBruto || item.vProd || 0)}</td>
                <td class="currency">${this.formatCurrency(item.descontoAplicado || item.vDesc || 0)}</td>
                <td class="currency">${this.formatCurrency(item.ipi || 0)}</td>
                <td class="currency">${this.formatCurrency(item.icmsst || 0)}</td>
                <td class="currency">${this.formatCurrency(item.outros || 0)}</td>
                <td class="currency">${this.formatCurrency(item.totalItem || 0)}</td>
                <td class="text-right" title="${item.notasCalculo?.observacaoUnidade || ''}">${unidadesText}</td>
                <td class="currency">${this.formatCurrency(item.unitarioReal || item.precoXML_unit || 0)}</td>
                <td class="text-right">${porLitroOuKgText}</td>
                <td class="currency">${this.formatCurrency(item.precoTabela)}</td>
                <td class="currency">${this.formatCurrency(item.precoMinimo)}</td>
                <td><span class="badge status-${item.status}">${this.formatStatus(item.status)}</span></td>
                <td class="text-center">${item.matchType}</td>
                <td>${item.observacoes}</td>
            `;

            tbody.appendChild(row);
        });
    }

    updateStats() {
        // Count by status
        const statusCounts = {
            OK: 0,
            ABAIXO_MINIMO: 0,
            SEM_PRECO: 0,
            ERRO_PARSING: 0
        };

        // Count by match type
        const matchCounts = {
            'EAN-Com': 0,
            'EAN-Trib': 0,
            'CODIGO': 0,
            'FUZZY': 0,
            'NULL': 0
        };

        this.data.forEach(item => {
            if (statusCounts.hasOwnProperty(item.status)) {
                statusCounts[item.status]++;
            }
            if (matchCounts.hasOwnProperty(item.matchType)) {
                matchCounts[item.matchType]++;
            }
        });

        // Update status counters
        Object.keys(statusCounts).forEach(status => {
            const element = document.getElementById(`count${status}`);
            if (element) {
                element.textContent = statusCounts[status].toLocaleString('pt-BR');
            }
        });

        // Update match type counters
        Object.keys(matchCounts).forEach(matchType => {
            const element = document.getElementById(`count${matchType}`);
            if (element) {
                element.textContent = matchCounts[matchType].toLocaleString('pt-BR');
            }
        });
    }

    exportToCSV() {
        if (this.filteredData.length === 0) {
            this.showError('Não há dados para exportar');
            return;
        }

        const headers = [
            'codigo',
            'descricao',
            'quantidadeXml',
            'unidade',
            'ean',
            'eanTrib',
            'eanExcel',
            'precoBruto',
            'descontoAplicado',
            'ipi',
            'icmsst',
            'outros',
            'totalItem',
            'unidadesInternas',
            'unitarioReal',
            'porLitroOuKg_tipo',
            'porLitroOuKg_valor',
            'precoTabela',
            'precoMinimo',
            'marginPercent',
            'status',
            'matchType',
            'observacoes',
            'observacaoUnidade'
        ];

        const csvContent = [
            headers.join(','),
            ...this.filteredData.map(item => 
                headers.map(header => {
                    let value;
                    if (header === 'porLitroOuKg_tipo') {
                        value = item.porLitroOuKg?.tipo || '';
                    } else if (header === 'porLitroOuKg_valor') {
                        value = item.porLitroOuKg?.unitario || '';
                    } else if (header === 'observacaoUnidade') {
                        value = item.notasCalculo?.observacaoUnidade || '';
                    } else if (header === 'marginPercent') {
                        value = this.marginPercent;
                    } else {
                        value = item[header] ?? '';
                    }
                    
                    // Escape quotes and wrap in quotes if contains comma or quotes
                    const stringValue = String(value).replace(/"/g, '""');
                    return stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')
                        ? `"${stringValue}"`
                        : stringValue;
                }).join(',')
            )
        ].join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `comparacao_precos_${new Date().toISOString().slice(0,10)}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    // Utility functions
    formatCurrency(value) {
        if (!value || value === 0) return 'R$ 0,00';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    }

    formatNumber(value) {
        if (!value || value === 0) return '0';
        return new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    }

    formatStatus(status) {
        const statusMap = {
            'OK': 'OK',
            'ABAIXO_MINIMO': 'Abaixo Mínimo',
            'SEM_PRECO': 'Sem Preço',
            'ERRO_PARSING': 'Erro Parsing'
        };
        return statusMap[status] || status;
    }

    formatPorLitroOuKg(porLitroOuKg) {
        if (!porLitroOuKg || !porLitroOuKg.tipo || !porLitroOuKg.unitario) {
            return '-';
        }
        return `R$/${porLitroOuKg.tipo} ${this.formatNumber(porLitroOuKg.unitario)}`;
    }

    formatUnidades(unidades, observacao) {
        if (!unidades) return '-';
        if (observacao && observacao.includes('unidade não identificada')) {
            return `⚠️ ${this.formatNumber(unidades)}`;
        }
        return this.formatNumber(unidades);
    }

    updateConferencia() {
        if (!this.conferencia) return;

        const somaItensEl = document.getElementById('somaItens');
        const vNFEl = document.getElementById('vNF');
        const diferencaEl = document.getElementById('diferenca');
        const statusEl = document.getElementById('statusConferencia');

        if (somaItensEl) {
            somaItensEl.textContent = this.formatCurrency(this.conferencia.somaItens);
        }

        if (vNFEl) {
            vNFEl.textContent = this.formatCurrency(this.conferencia.vNFTotal || 0);
        }

        const diferenca = this.conferencia.diferenca || 0;
        if (diferencaEl) {
            diferencaEl.textContent = this.formatCurrency(diferenca);
        }

        if (statusEl) {
            if (Math.abs(diferenca) < 0.01) {
                statusEl.innerHTML = '✅ OK';
                statusEl.className = 'conference-status ok';
            } else {
                statusEl.innerHTML = '⚠️ DIFERENÇA';
                statusEl.className = 'conference-status warning';
            }
        }
    }

    showCalculationDetails() {
        if (this.filteredData.length === 0) {
            this.showError('Nenhum item selecionado para mostrar detalhes');
            return;
        }

        const item = this.filteredData[0]; // Mostrar detalhes do primeiro item filtrado
        const details = `
Detalhes de Cálculo - ${item.descricao}

` +
            `Preço Bruto: R$ ${(item.precoBruto || 0).toFixed(2)}
` +
            `Desconto Aplicado: R$ ${(item.descontoAplicado || 0).toFixed(2)}
` +
            `IPI: R$ ${(item.ipi || 0).toFixed(2)}
` +
            `ICMS-ST: R$ ${(item.icmsst || 0).toFixed(2)}
` +
            `Outros: R$ ${(item.outros || 0).toFixed(2)}
` +
            `Total Item: R$ ${(item.totalItem || 0).toFixed(2)}

` +
            `Unidades Calculadas: ${item.unidadesInternas || 'N/A'}
` +
            `Tipo de Unidade: ${item.notasCalculo?.tipoUnidade || 'N/A'}
` +
            `Observação: ${item.notasCalculo?.observacaoUnidade || 'N/A'}

` +
            `Unitário Real: R$ ${(item.unitarioReal || 0).toFixed(4)}
` +
            `Fórmula: Total Item (ç Unidades) = ${(item.totalItem || 0).toFixed(2)} ÷ ${item.unidadesInternas || 1} = R$ ${(item.unitarioReal || 0).toFixed(4)}`;

        alert(details);
    }
    
    updateMarginDisplay() {
        const marginDisplay = document.getElementById('marginDisplay');
        const multiplier = (1 + this.marginPercent / 100).toFixed(1);
        if (marginDisplay) {
            marginDisplay.textContent = multiplier;
        }
    }

    clearFiles(type) {
        const fileInput = document.getElementById(`${type}File`);
        const fileNameElement = document.getElementById(`${type}FileName`);
        const uploadArea = fileInput.closest('.upload-label').querySelector('.upload-area');
        
        // Limpar o input de arquivo
        fileInput.value = '';
        
        // Limpar o nome do arquivo exibido
        if (fileNameElement) {
            fileNameElement.textContent = '';
        }
        
        // Remover a classe has-file
        if (uploadArea) {
            uploadArea.classList.remove('has-file');
        }
        
        // Atualizar estado dos botões
        this.updateButtonStates();
        this.updateClearButtonStates();
        
        console.log(`Arquivos ${type.toUpperCase()} limpos`);
    }

    updateClearButtonStates() {
        const xmlFiles = document.getElementById('xmlFile').files;
        const xlsxFile = document.getElementById('xlsxFile').files[0];
        
        const clearXmlBtn = document.getElementById('clearXmlBtn');
        const clearXlsxBtn = document.getElementById('clearXlsxBtn');
        
        if (clearXmlBtn) {
            clearXmlBtn.disabled = !xmlFiles.length;
        }
        
        if (clearXlsxBtn) {
            clearXlsxBtn.disabled = !xlsxFile;
        }
    }
    
    recalculateWithNewMargin() {
        // Recalcular preço mínimo e status para todos os itens
        const multiplier = 1 + this.marginPercent / 100;
        
        this.data.forEach(item => {
            const unitarioReal = item.unitarioReal || 0;
            item.precoMinimo = Math.round(unitarioReal * multiplier * 10000) / 10000;
            
            // Recalcular status
            if (unitarioReal <= 0) {
                item.status = 'ERRO_PARSING';
            } else if (item.precoTabela <= 0) {
                item.status = 'SEM_PRECO';
            } else if (item.precoTabela >= item.precoMinimo) {
                item.status = 'OK';
            } else {
                item.status = 'ABAIXO_MINIMO';
            }
        });
        
        // Reaplicar filtros e atualizar exibição
        this.applyFilters();
        this.updateStats();
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.toggle('show', show);
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.add('show');
            
            // Auto hide after 5 seconds
            setTimeout(() => {
                this.hideError();
            }, 5000);
        }
    }

    hideError() {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.classList.remove('show');
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new NFEComparator();
});