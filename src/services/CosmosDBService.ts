import { CosmosClient, Container, FeedOptions } from "@azure/cosmos";
import { inject, injectable, named } from "inversify";
import { LogService } from "./LogService";
import { QueryUtilities } from "../utilities/queryUtilities";
import { Actor, Movie } from "../models";
import { defaultPageSize, maxPageSize } from "../config/constants";

/**
 * Handles executing queries against CosmosDB
 */
@injectable()
export class CosmosDBService {

    private cosmosClient: CosmosClient;
    private cosmosContainer: Container;
    private feedOptions: FeedOptions = { maxItemCount: 2000 };

    public ready: Promise<void>;

    /**
     * Creates a new instance of the CosmosDB class.
     * @param url The url of the CosmosDB.
     * @param accessKey The CosmosDB access key (primary of secondary).
     * @param logger Logging service user for tracing/logging.
     */
    constructor(
        @inject("string") @named("cosmosDbUrl") private url: string,
        @inject("string") @named("cosmosDbKey") accessKey: string,
        @inject("string") @named("database") public databaseId: string,
        @inject("string") @named("collection") public containerId: string,
        @inject("LogService") private logger: LogService) {

        this.cosmosClient = new CosmosClient({ endpoint: url, key: accessKey });
        this.ready = this.initialize();
    }

    /**
     * Initialize the Cosmos DB Container.
     * This is handled in a separate method to avoid calling async operations in the constructor.
     */
    public async initialize(): Promise<void> {

        this.logger.trace("Initializing CosmosDB Container");
        try {
            this.cosmosContainer = await this.cosmosClient.database(this.databaseId).container(this.containerId);
        } catch (err) {
            this.logger.error(Error(err), err);
        }
        return;
    }

    /**
     * Runs the given query against CosmosDB.
     * @param query The query to select the documents.
     */
    public async queryDocuments(query: string): Promise<any> {
        const { resources: queryResults } = await this.cosmosContainer.items.query(query, this.feedOptions).fetchAll();
        return queryResults;
    }

    /**
     * Retrieves a specific document by Id.
     * @param documentId The id of the document to query.
     */
    public async getDocument(documentId: string): Promise<any> {
        const { resource: result, statusCode: status }
            = await this.cosmosContainer.item(documentId, QueryUtilities.getPartitionKey(documentId)).read();
        if (status === 200) {
            return result;
        }
        
        // 404 not found does not throw an error
        throw Error("Cosmos Error: " + status);
    }

    /**
     * Runs the given query for actors against the database.
     * @param queryParams The query params used to select the actor documents.
     */
    public async queryActors(queryParams: any): Promise<Actor[]> {
        const ACTOR_SELECT = "select m.id, m.partitionKey, m.actorId, m.type, m.name, m.birthYear, m.deathYear, m.profession, m.textSearch, m.movies from m where m.type = 'Actor' ";
        const ACTOR_ORDER_BY = " order by m.textSearch, m.actorId";

        let sql = ACTOR_SELECT;

        let pageSize = 100;
        let pageNumber = 1;
        let actorName: string = queryParams.q;

        // handle paging parameters
        // fall back to default values if none provided in query
        pageSize = (queryParams.pageSize) ? queryParams.pageSize : pageSize;
        pageNumber = (queryParams.pageNumber) ? queryParams.pageNumber : pageNumber;

        if (pageSize < 1) {
            pageSize = defaultPageSize;
        } else if (pageSize > maxPageSize) {
            pageSize = maxPageSize;
        }

        pageNumber--;

        if (pageNumber < 0) {
            pageNumber = 0;
        }

        const offsetLimit = " offset " + (pageNumber * pageSize) + " limit " + pageSize + " ";

        // apply search term if provided in query
        if (actorName) {
            actorName = actorName.trim().toLowerCase().replace("'", "''");

            if (actorName) {
                sql += " and contains(m.textSearch, '" + actorName + "')";
            }
        }

        sql += ACTOR_ORDER_BY + offsetLimit;

        return await this.queryDocuments(sql);
    }

    /**
     * Runs the given query for movies against the database.
     * @param queryParams The query params used to select the movie documents.
     */
    public async queryMovies(queryParams: any): Promise<Movie[]> {
        const MOVIE_SELECT = "select m.id, m.partitionKey, m.movieId, m.type, m.textSearch, m.title, m.year, m.runtime, m.rating, m.votes, m.totalScore, m.genres, m.roles from m where m.type = 'Movie' ";
        const MOVIE_ORDER_BY = " order by m.textSearch, m.movieId";

        let sql: string = MOVIE_SELECT;

        let pageSize = 100;
        let pageNumber = 1;
        let queryParam: string;
        let actorId: string;
        let genre: string;

        // handle paging parameters
        // fall back to default values if none provided in query
        pageSize = (queryParams.pageSize) ? queryParams.pageSize : pageSize;
        pageNumber = (queryParams.pageNumber) ? queryParams.pageNumber : pageNumber;

        if (pageSize < 1) {
            pageSize = defaultPageSize;
        } else if (pageSize > maxPageSize) {
            pageSize = maxPageSize;
        }

        pageNumber--;

        if (pageNumber < 0) {
            pageNumber = 0;
        }

        const offsetLimit = " offset " + (pageNumber * pageSize) + " limit " + pageSize + " ";

        // handle query parameters and build sql query
        if (queryParams.q) {
            queryParam = queryParams.q.trim().toLowerCase().replace("'", "''");
            if (queryParam) {
                sql += " and contains(m.textSearch, '" + queryParam + "') ";
            }
        }

        if (queryParams.year > 0) {
            sql += " and m.year = " + queryParams.year + " ";
        }

        if (queryParams.rating > 0) {
            sql += " and m.rating >= " + queryParams.rating + " ";
        }

        if (queryParams.actorId) {
            actorId = queryParams.actorId.trim().toLowerCase().replace("'", "''");

            if (actorId) {
                sql += " and array_contains(m.roles, { actorId: '";
                sql += actorId;
                sql += "' }, true) ";
            }
        }

        if (queryParams.genre) {
            let genreResult: any;

            try {
                genreResult = await this.getDocument(queryParams.genre.trim().toLowerCase());
                genre = genreResult.genre;
            } catch (err) {
                if (err.toString().includes("404")) {
                    // return empty array if no genre found
                    return [];
                }
            }

            sql += " and array_contains(m.genres, '" + genre + "')";
        }

        sql += MOVIE_ORDER_BY + offsetLimit;

        return await this.queryDocuments(sql);
    }
}