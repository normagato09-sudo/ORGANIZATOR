/**
 * ORGANIZATOR - Base de Datos con IndexedDB (Fase 2.1)
 * Sistema persistente de almacenamiento de datos
 * 
 * Utiliza IndexedDB para persistencia en el navegador
 * sin necesidad de backend externo.
 */

const DB_NAME = 'ORGANIZATOR_DB';
const DB_VERSION = 1;

// Nombres de los object stores (colecciones)
const STORES = {
  // Cole
  COLE_SUBJECTS: 'coleSubjects',
  COLE_TASKS: 'coleTasks',
  COLE_EXAMS: 'coleExams',
  COLE_WORKS: 'coleWorks',
  
  // CESI
  CESI_MEETINGS: 'cesiMeetings',
  CESI_TASKS: 'cesiTasks',
  CESI_EVENTS: 'cesiEvents',
  
  // Casa
  HOUSE_TASKS: 'houseTasks',
  HOUSE_REMINDERS: 'houseReminders',
  
  // Compras
  SHOPPING_LISTS: 'shoppingLists',
  SHOPPING_ITEMS: 'shoppingItems',
  
  // Vacaciones
  VACATIONS: 'vacations',
  HOLIDAYS: 'holidays',
  TRIPS: 'trips',
  
  // Rubik
  RUBIK_SESSIONS: 'rubikSessions',
  RUBIK_SOLVES: 'rubikSolves',
  RUBIK_CUBES: 'rubikCubes',
  RUBIK_STATS: 'rubikStats',
  
  // General
  GENERAL_EVENTS: 'generalEvents',
};

class OrganzatorDB {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  /**
   * Inicializa la base de datos
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        console.log('✅ Base de datos ORGANIZATOR inicializada');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        this._createStores(db);
      };
    });
  }

  /**
   * Crea los object stores (solo en la primera inicialización)
   * @private
   */
  _createStores(db) {
    const stores = Object.values(STORES);
    
    stores.forEach(storeName => {
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: 'id' });
        
        // Crear índices comunes
        if (storeName !== STORES.SHOPPING_ITEMS) {
          store.createIndex('area', 'area', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        
        // Índices específicos
        if (storeName.includes('Task') || storeName.includes('Tasks')) {
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
          if (storeName === STORES.COLE_TASKS) {
            store.createIndex('subjectId', 'subjectId', { unique: false });
          }
        }
        
        if (storeName.includes('Date') || storeName.includes('Exam')) {
          store.createIndex('date', 'date', { unique: false });
        }
        
        if (storeName === STORES.SHOPPING_ITEMS) {
          store.createIndex('listId', 'listId', { unique: false });
          store.createIndex('purchased', 'purchased', { unique: false });
        }
        
        if (storeName === STORES.SHOPPING_LISTS) {
          store.createIndex('status', 'status', { unique: false });
        }
      }
    });
  }

  /**
   * Añade o actualiza un elemento
   * @param {string} storeName - Nombre del store
   * @param {Object} item - Elemento a guardar
   * @returns {Promise<string>} ID del elemento
   */
  async set(storeName, item) {
    if (!this.initialized) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      
      // Si no tiene ID, generar uno
      if (!item.id) {
        item.id = this._generateId();
      }
      
      // Actualizar fecha de modificación
      item.updatedAt = new Date();
      
      const request = store.put(item);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(item.id);
    });
  }

  /**
   * Obtiene un elemento por ID
   * @param {string} storeName - Nombre del store
   * @param {string} id - ID del elemento
   * @returns {Promise<Object|undefined>}
   */
  async get(storeName, id) {
    if (!this.initialized) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Obtiene todos los elementos de un store
   * @param {string} storeName - Nombre del store
   * @returns {Promise<Object[]>}
   */
  async getAll(storeName) {
    if (!this.initialized) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  /**
   * Obtiene elementos filtrados por un índice
   * @param {string} storeName - Nombre del store
   * @param {string} indexName - Nombre del índice
   * @param {*} value - Valor a buscar
   * @returns {Promise<Object[]>}
   */
  async query(storeName, indexName, value) {
    if (!this.initialized) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  /**
   * Elimina un elemento
   * @param {string} storeName - Nombre del store
   * @param {string} id - ID del elemento
   * @returns {Promise<void>}
   */
  async delete(storeName, id) {
    if (!this.initialized) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Elimina todos los elementos de un store
   * @param {string} storeName - Nombre del store
   * @returns {Promise<void>}
   */
  async clear(storeName) {
    if (!this.initialized) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Obtiene conteo de elementos
   * @param {string} storeName - Nombre del store
   * @returns {Promise<number>}
   */
  async count(storeName) {
    if (!this.initialized) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.count();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Genera un UUID simple
   * @private
   */
  _generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Exporta todos los datos a JSON (para backup)
   * @returns {Promise<Object>}
   */
  async exportAllData() {
    if (!this.initialized) await this.init();
    
    const allData = {};
    for (const storeName of Object.values(STORES)) {
      allData[storeName] = await this.getAll(storeName);
    }
    return allData;
  }

  /**
   * Importa datos desde JSON (para restore)
   * @param {Object} data - Datos a importar
   * @returns {Promise<void>}
   */
  async importAllData(data) {
    if (!this.initialized) await this.init();
    
    for (const storeName of Object.values(STORES)) {
      if (data[storeName] && Array.isArray(data[storeName])) {
        for (const item of data[storeName]) {
          await this.set(storeName, item);
        }
      }
    }
  }
}

// Instancia global de la base de datos
const db = new OrganzatorDB();

// Inicializar al cargar el script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => db.init());
} else {
  db.init();
}
