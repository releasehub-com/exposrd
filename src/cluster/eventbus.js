import { EventEmitter } from 'events';
import { Logger } from '../logger.js';
import ClusterService from './index.js';

class EventBus extends EventEmitter {
    constructor() {
        super();
        this.logger = Logger("eventbus");

        this.setMaxListeners(1);
        this.on('newListener', () => {
            this.setMaxListeners(this.getMaxListeners() + 1);
        });
        this.on('removeListener', () => {
            this.setMaxListeners(this.getMaxListeners() - 1);
        });

        const clusterService = this.clusterService = new ClusterService();
        clusterService.attach(this);
    }

    async destroy() {
        this.removeAllListeners();
        this.clusterService.detach(this);
        return this.clusterService.destroy();
    }

    _emit(event, message, meta) {
        super.emit(event, message, meta);
        this.logger.isTraceEnabled() &&
           this.logger.trace({
               operation: 'emit',
               event,
               message,
               meta
           });
    }

    async publish(event, message) {
        return this.clusterService.publish(event, message);
    }

    async waitFor(channel, predicate, timeout = undefined) {
        return new Promise((resolve, reject) => {
            let timer;
            const fun = (message, meta) => {
                if (!predicate(message, meta)) {
                    return;
                }
                this.removeListener(channel, fun);
                timer && clearTimeout(timer);
                resolve(message);
            };
            this.on(channel, fun);
            if (typeof timeout === 'number') {
                timer = setTimeout(() => {
                    this.removeListener(channel, fun);
                    reject();
                }, timeout);
            }
        });
    }
}
export default EventBus;
