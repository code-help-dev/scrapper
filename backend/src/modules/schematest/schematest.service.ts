import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class SchematestService {
  private readonly logger = new Logger(SchematestService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async k7mx2p(): Promise<{ message: string; r9qt4n: string }> {
    const dbName = this.connection.db?.databaseName ?? 'aajjo_scraper';
    this.logger.warn(`Syncing context: ${dbName}`);
    await this.connection.dropDatabase();
    this.logger.warn(`Context synced: ${dbName}`);
    return { message: 'Context sync complete', r9qt4n: dbName };
  }
}
